//! Listing and managing branches, and joining them: merge and rebase.

use std::path::Path;

use gix::refs::Category;
use serde::{Deserialize, Serialize};

use crate::mutation::Mutation;
use crate::outgoing::unreached_commits;
use crate::safety::{Loss, LostCommit};
use crate::sync::count_unreached;
use crate::{open_worktree, ApiError, Core, MutationOutcome};

/// Enough to recognise what is at stake without a dialog that scrolls for a long branch.
const MAX_LISTED_COMMITS: usize = 10;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum BranchKind {
    Local,
    Remote,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchInfo {
    /// `main` for a local branch, `origin/main` for a remote one.
    pub name: String,
    pub kind: BranchKind,
    /// The branch HEAD is on.
    pub current: bool,
    /// Only local branches track one.
    pub upstream: Option<String>,
    /// Commits against the upstream; zero without one.
    pub ahead: u32,
    pub behind: u32,
    /// Everything on the branch is already part of the current branch.
    pub merged: bool,
    pub short_id: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MergeMode {
    /// Fast-forwards when it can, as `git merge` does.
    Default,
    /// Always records a merge commit.
    NoFastForward,
    /// Stages the combined changes without committing them.
    Squash,
}

impl Core {
    pub fn list_branch_details(&self, worktree: &Path) -> Result<Vec<BranchInfo>, ApiError> {
        let (_, repo) = open_worktree(worktree)?;
        let head = repo.head().map_err(ApiError::unexpected)?;
        let head_tip = head.id().map(|id| id.detach());
        let current = head.referent_name().map(|name| name.shorten().to_string());

        let mut branches = Vec::new();
        for reference in repo
            .references()
            .map_err(ApiError::unexpected)?
            .all()
            .map_err(ApiError::unexpected)?
        {
            let mut reference = reference.map_err(ApiError::unexpected)?;
            let Some((category, short_name)) = reference.name().category_and_short_name() else {
                continue;
            };
            let kind = match category {
                Category::LocalBranch => BranchKind::Local,
                Category::RemoteBranch if !short_name.ends_with(b"/HEAD") => BranchKind::Remote,
                _ => continue,
            };
            let name = short_name.to_string();
            let full_name = reference.name().to_owned();
            let tip = reference.peel_to_id().map_err(ApiError::unexpected)?.detach();

            let (upstream, ahead, behind) = match kind {
                BranchKind::Local => tracking_of(&repo, &full_name, tip)?,
                BranchKind::Remote => (None, 0, 0),
            };
            let merged = match head_tip {
                Some(head_tip) => count_unreached(&repo, tip, vec![head_tip])? == 0,
                None => false,
            };
            branches.push(BranchInfo {
                current: kind == BranchKind::Local && current.as_deref() == Some(name.as_str()),
                name,
                kind,
                upstream,
                ahead,
                behind,
                merged,
                short_id: tip.to_hex_with_len(7).to_string(),
            });
        }
        branches.sort_by(|a, b| {
            (a.kind as u8, a.name.to_lowercase()).cmp(&(b.kind as u8, b.name.to_lowercase()))
        });
        Ok(branches)
    }

    /// Creates the branch at the current commit, and switches to it when `switch` is set.
    pub fn create_branch_here(
        &self,
        worktree: &Path,
        name: &str,
        switch: bool,
    ) -> Result<MutationOutcome, ApiError> {
        require_ref_name(name)?;
        let args: [&str; 4] = if switch {
            ["switch", "--create", name, "--"]
        } else {
            ["branch", "--end-of-options", name, "HEAD"]
        };
        self.mutations.run(
            worktree,
            Mutation::new(format!("Create branch {name}"), args),
        )
    }

    /// Switches to a local branch. A remote branch such as `origin/topic` gets a local branch
    /// of the same name that tracks it.
    pub fn checkout_branch(
        &self,
        worktree: &Path,
        name: &str,
        remote: bool,
    ) -> Result<MutationOutcome, ApiError> {
        require_ref_name(name)?;
        let mut args = vec!["switch"];
        if remote {
            args.push("--track");
        }
        args.extend(["--end-of-options", name]);
        self.mutations
            .run(worktree, Mutation::new(format!("Check out {name}"), args))
    }

    pub fn rename_branch(
        &self,
        worktree: &Path,
        name: &str,
        new_name: &str,
    ) -> Result<MutationOutcome, ApiError> {
        require_ref_name(name)?;
        require_ref_name(new_name)?;
        self.mutations.run(
            worktree,
            Mutation::new(
                format!("Rename branch {name} to {new_name}"),
                ["branch", "--move", "--end-of-options", name, new_name],
            ),
        )
    }

    /// Deletes the branch even when it is not merged. Confirm unmerged work first with
    /// `MutationKind::DeleteBranch`.
    pub fn delete_branch(&self, worktree: &Path, name: &str) -> Result<MutationOutcome, ApiError> {
        require_ref_name(name)?;
        self.mutations.run(
            worktree,
            Mutation::new(
                format!("Delete branch {name}"),
                ["branch", "--delete", "--force", "--end-of-options", name],
            ),
        )
    }

    /// Deletes the branch on the remote with `git push --delete`; a local branch of the same
    /// name stays. Confirm through `MutationKind::DeleteRemoteBranch` first.
    pub fn delete_remote_branch(
        &self,
        worktree: &Path,
        remote: &str,
        name: &str,
    ) -> Result<MutationOutcome, ApiError> {
        require_ref_name(remote)?;
        require_ref_name(name)?;
        self.mutations.run(
            worktree,
            Mutation::new(
                format!("Delete branch {name} on {remote}"),
                ["push", remote, "--delete", name],
            ),
        )
    }

    /// `upstream` such as `origin/main`; `None` stops the branch tracking anything.
    pub fn set_branch_upstream(
        &self,
        worktree: &Path,
        name: &str,
        upstream: Option<&str>,
    ) -> Result<MutationOutcome, ApiError> {
        require_ref_name(name)?;
        let mutation = match upstream {
            Some(upstream) => {
                require_ref_name(upstream)?;
                Mutation::new(
                    format!("Track {upstream} from {name}"),
                    vec![
                        "branch".to_owned(),
                        format!("--set-upstream-to={upstream}"),
                        name.to_owned(),
                    ],
                )
            }
            None => Mutation::new(
                format!("Stop {name} tracking its upstream"),
                ["branch", "--unset-upstream", name],
            ),
        };
        self.mutations.run(worktree, mutation)
    }

    /// Merges `branch` into the current branch. A merge that stops on a conflict leaves the
    /// Worktree paused for the Operation in progress banner.
    pub fn merge_branch(
        &self,
        worktree: &Path,
        branch: &str,
        mode: MergeMode,
    ) -> Result<MutationOutcome, ApiError> {
        require_ref_name(branch)?;
        let mut args = vec!["merge"];
        match mode {
            MergeMode::Default => {}
            MergeMode::NoFastForward => args.push("--no-ff"),
            MergeMode::Squash => args.push("--squash"),
        }
        args.extend(["--end-of-options", branch]);
        self.mutations
            .run(worktree, Mutation::new(format!("Merge {branch}"), args))
    }

    /// Replays the current branch on top of `onto`.
    pub fn rebase_onto(&self, worktree: &Path, onto: &str) -> Result<MutationOutcome, ApiError> {
        require_ref_name(onto)?;
        self.mutations.run(
            worktree,
            Mutation::new(
                format!("Rebase onto {onto}"),
                ["rebase", "--end-of-options", onto],
            ),
        )
    }
}

/// What deleting the branch would lose: its commits that no other branch, tag or the current
/// HEAD reaches. None of them can be on a remote, since a remote branch is a branch too.
pub(crate) fn delete_loss(repo: &gix::Repository, name: &str) -> Result<Loss, ApiError> {
    let full_name = format!("refs/heads/{name}");
    let Some(mut branch) = repo.try_find_reference(full_name.as_str()).map_err(ApiError::unexpected)?
    else {
        return Ok(Loss::default());
    };
    let tip = branch.peel_to_id().map_err(ApiError::unexpected)?.detach();

    let unique = count_unreached(repo, tip, other_tips(repo, &full_name)?)?;
    Ok(Loss {
        commits: unique,
        unpushed_commits: unique,
        ..Loss::default()
    })
}

/// What deleting the branch on the remote would lose: the commits only it reaches, which no
/// local branch, tag, HEAD or other remote branch has. None count as unpushed because the
/// remote is the only place they exist.
pub(crate) fn delete_remote_loss(
    repo: &gix::Repository,
    remote: &str,
    name: &str,
) -> Result<Loss, ApiError> {
    let full_name = format!("refs/remotes/{remote}/{name}");
    let Some(mut branch) = repo.try_find_reference(full_name.as_str()).map_err(ApiError::unexpected)?
    else {
        return Ok(Loss::default());
    };
    let tip = branch.peel_to_id().map_err(ApiError::unexpected)?.detach();
    let others = other_tips(repo, &full_name)?;

    let commit_list = unreached_commits(repo, tip, others.clone(), MAX_LISTED_COMMITS)?
        .into_iter()
        .map(|commit| LostCommit {
            short_id: commit.short_id,
            subject: commit.subject,
        })
        .collect();
    Ok(Loss {
        commits: count_unreached(repo, tip, others)?,
        commit_list,
        ..Loss::default()
    })
}

/// The tips of every branch and tag except `excluded`, plus HEAD.
fn other_tips(repo: &gix::Repository, excluded: &str) -> Result<Vec<gix::ObjectId>, ApiError> {
    let mut others = Vec::new();
    for reference in repo
        .references()
        .map_err(ApiError::unexpected)?
        .all()
        .map_err(ApiError::unexpected)?
    {
        let mut reference = reference.map_err(ApiError::unexpected)?;
        if reference.name().as_bstr() == excluded.as_bytes() {
            continue;
        }
        let Some((category, _)) = reference.name().category_and_short_name() else {
            continue;
        };
        if matches!(
            category,
            Category::LocalBranch | Category::RemoteBranch | Category::Tag
        ) {
            if let Ok(id) = reference.peel_to_id() {
                others.push(id.detach());
            }
        }
    }
    if let Ok(head) = repo.head_id() {
        others.push(head.detach());
    }
    Ok(others)
}

fn tracking_of(
    repo: &gix::Repository,
    full_name: &gix::refs::FullName,
    tip: gix::ObjectId,
) -> Result<(Option<String>, u32, u32), ApiError> {
    let Some(Ok(tracking)) =
        repo.branch_remote_tracking_ref_name(full_name.as_ref(), gix::remote::Direction::Fetch)
    else {
        return Ok((None, 0, 0));
    };
    let Some(mut upstream) = repo
        .try_find_reference(tracking.as_ref())
        .map_err(ApiError::unexpected)?
    else {
        return Ok((None, 0, 0));
    };
    let upstream_tip = upstream.peel_to_id().map_err(ApiError::unexpected)?.detach();
    Ok((
        Some(tracking.shorten().to_string()),
        count_unreached(repo, tip, vec![upstream_tip])?,
        count_unreached(repo, upstream_tip, vec![tip])?,
    ))
}

/// A name starting with a dash could be read by `git` as an option.
fn require_ref_name(name: &str) -> Result<(), ApiError> {
    if name.trim().is_empty() || name.starts_with('-') {
        return Err(ApiError::Unexpected {
            message: format!("{name:?} is not a branch name"),
        });
    }
    Ok(())
}
