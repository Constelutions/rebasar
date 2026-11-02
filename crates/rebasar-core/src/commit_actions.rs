//! The safe operations offered on a commit in History. Each runs as a mutation.

use std::path::Path;

use gix::bstr::ByteSlice;
use gix::refs::Category;
use serde::{Deserialize, Serialize};

use crate::mutation::Mutation;
use crate::safety::Loss;
use crate::sync::count_unreached;
use crate::{commit, open_worktree, status, ApiError, Core, MutationOutcome};

/// What a reset does with the changes between where HEAD was and where it goes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ResetMode {
    /// Keeps them staged.
    Soft,
    /// Keeps them as unstaged changes.
    Mixed,
    /// Throws them away, along with every other uncommitted change.
    Hard,
}

const SHORT_ID_LENGTH: usize = 7;

impl Core {
    /// Detaches HEAD at the commit; fails, changing nothing, if that would overwrite local changes.
    pub fn checkout_commit(
        &self,
        worktree: &Path,
        commit: &str,
    ) -> Result<MutationOutcome, ApiError> {
        require_commit_id(commit)?;
        self.mutations.run(
            worktree,
            Mutation::new(
                format!("Check out {}", short(commit)),
                ["checkout", "--detach", commit],
            ),
        )
    }

    /// Creates the branch without switching to it.
    pub fn create_branch(
        &self,
        worktree: &Path,
        name: &str,
        commit: &str,
    ) -> Result<MutationOutcome, ApiError> {
        require_commit_id(commit)?;
        self.mutations.run(
            worktree,
            Mutation::new(
                format!("Create branch {name}"),
                ["branch", "--end-of-options", name, commit],
            ),
        )
    }

    /// Creates a lightweight tag; an existing tag is never moved.
    pub fn create_tag(
        &self,
        worktree: &Path,
        name: &str,
        commit: &str,
    ) -> Result<MutationOutcome, ApiError> {
        require_commit_id(commit)?;
        self.mutations.run(
            worktree,
            Mutation::new(
                format!("Create tag {name}"),
                ["tag", "--end-of-options", name, commit],
            ),
        )
    }

    /// Applies the commit's changes on top of HEAD. A conflict leaves the Worktree paused for the
    /// Operation in progress banner.
    pub fn cherry_pick_commit(
        &self,
        worktree: &Path,
        commit: &str,
    ) -> Result<MutationOutcome, ApiError> {
        self.run_replay(worktree, commit, "Cherry-pick", "cherry-pick")
    }

    /// Adds a commit that undoes the given one. A conflict leaves the Worktree paused.
    pub fn revert_commit(&self, worktree: &Path, commit: &str) -> Result<MutationOutcome, ApiError> {
        self.run_replay(worktree, commit, "Revert", "revert")
    }

    fn run_replay(
        &self,
        worktree: &Path,
        commit_id: &str,
        verb: &str,
        command: &str,
    ) -> Result<MutationOutcome, ApiError> {
        require_commit_id(commit_id)?;
        let (_, repo) = open_worktree(worktree)?;
        let is_merge = commit::find(&repo, commit_id)?.parent_ids().count() > 1;
        drop(repo);

        let mut args = vec![command];
        if command == "revert" {
            args.push("--no-edit");
        }
        if is_merge {
            // A merge has no single parent to diff against; the first one is the branch it
            // was merged into.
            args.extend(["--mainline", "1"]);
        }
        args.push(commit_id);
        self.mutations.run(
            worktree,
            Mutation::new(format!("{verb} {}", short(commit_id)), args),
        )
    }

    /// Moves the current branch to the commit. Confirm through `MutationKind::Reset` first:
    /// every mode can drop commits, and a hard reset also drops uncommitted work.
    pub fn reset_to_commit(
        &self,
        worktree: &Path,
        commit_id: &str,
        mode: ResetMode,
    ) -> Result<MutationOutcome, ApiError> {
        require_commit_id(commit_id)?;
        let flag = match mode {
            ResetMode::Soft => "--soft",
            ResetMode::Mixed => "--mixed",
            ResetMode::Hard => "--hard",
        };
        self.mutations.run(
            worktree,
            Mutation::new(
                format!("Reset {} to {}", flag.trim_start_matches("--"), short(commit_id)),
                ["reset", flag, commit_id],
            ),
        )
    }

    /// Replaces the message of the commit HEAD points at, leaving anything staged out of it.
    /// `commit` is the commit the caller saw as the latest; if HEAD has moved since, nothing is
    /// rewritten, so a stale view can never reword a different commit.
    pub fn reword_latest_commit(
        &self,
        worktree: &Path,
        commit: &str,
        message: &str,
    ) -> Result<MutationOutcome, ApiError> {
        require_commit_id(commit)?;
        let (_, repo) = open_worktree(worktree)?;
        let head = repo.head_id().map_err(ApiError::unexpected)?;
        if !head.to_string().eq_ignore_ascii_case(commit) {
            return Err(ApiError::Unexpected {
                message: format!("{} is no longer the latest commit", short(commit)),
            });
        }
        drop(repo);

        self.mutations.run(
            worktree,
            Mutation::new(
                format!("Reword {}", short(commit)),
                ["commit", "--amend", "--only", "--message", message],
            ),
        )
    }
}

/// Anything else could be read by `git` as an option or as a name that resolves elsewhere.
fn require_commit_id(commit: &str) -> Result<(), ApiError> {
    let is_id = matches!(commit.len(), 40 | 64) && commit.bytes().all(|b| b.is_ascii_hexdigit());
    if is_id {
        return Ok(());
    }
    Err(ApiError::Unexpected {
        message: format!("{commit} is not a commit id"),
    })
}

fn short(commit: &str) -> &str {
    &commit[..SHORT_ID_LENGTH.min(commit.len())]
}

/// What resetting to `commit_id` would lose: the commits of the current branch that nothing
/// else reaches afterwards (none of them can be on a remote, since a remote branch is a branch
/// too), and for a hard reset the uncommitted work.
pub(crate) fn reset_loss(
    repo: &gix::Repository,
    commit_id: &str,
    mode: ResetMode,
) -> Result<Loss, ApiError> {
    require_commit_id(commit_id)?;
    let target = commit::find(repo, commit_id)?.id;
    let head = repo.head().map_err(ApiError::unexpected)?;
    let Some(tip) = head.id().map(|id| id.detach()) else {
        return Ok(Loss::default());
    };
    let current: Option<Vec<u8>> = head.referent_name().map(|name| name.as_bstr().to_vec());

    let mut kept = vec![target];
    for reference in repo
        .references()
        .map_err(ApiError::unexpected)?
        .all()
        .map_err(ApiError::unexpected)?
    {
        let mut reference = reference.map_err(ApiError::unexpected)?;
        if current.as_deref() == Some(reference.name().as_bstr().as_bytes()) {
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
                kept.push(id.detach());
            }
        }
    }
    let dropped = count_unreached(repo, tip, kept)?;

    let files = if mode == ResetMode::Hard {
        let status = status::read(repo)?;
        status
            .conflicts
            .into_iter()
            .chain(status.staged)
            .chain(status.unstaged)
            .filter(|file| file.kind != status::ChangeKind::Untracked)
            .collect()
    } else {
        Vec::new()
    };
    Ok(Loss {
        files,
        commits: dropped,
        unpushed_commits: dropped,
        ..Loss::default()
    })
}
