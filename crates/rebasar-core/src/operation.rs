//! The merge, rebase, cherry-pick or revert Git is paused in the middle of, however it was
//! started, and the ways to finish or leave it.

use std::collections::BTreeSet;
use std::fs;
use std::path::Path;

use serde::Serialize;

use crate::mutation::Mutation;
use crate::safety::Loss;
use crate::{open_worktree, outgoing, status, ApiError, Core, MutationOutcome};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum OperationKind {
    Merge,
    Rebase,
    CherryPick,
    Revert,
}

impl OperationKind {
    fn command(self) -> &'static str {
        match self {
            Self::Merge => "merge",
            Self::Rebase => "rebase",
            Self::CherryPick => "cherry-pick",
            Self::Revert => "revert",
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::Merge => "merge",
            Self::Rebase => "rebase",
            Self::CherryPick => "cherry-pick",
            Self::Revert => "revert",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationStep {
    pub current: u32,
    pub total: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationInProgress {
    pub kind: OperationKind,
    /// Known for a rebase, which replays its commits one by one.
    pub step: Option<OperationStep>,
    /// Files still waiting for a resolution.
    pub conflicts: u32,
    /// A merge has a single step, so there is nothing to skip.
    pub can_skip: bool,
}

#[derive(Debug, Clone, Copy)]
enum Action {
    Continue,
    Skip,
    Abort,
}

impl Core {
    /// `None` when the Worktree is not paused in the middle of an operation.
    pub fn operation_in_progress(
        &self,
        worktree: &Path,
    ) -> Result<Option<OperationInProgress>, ApiError> {
        let (_, repo) = open_worktree(worktree)?;
        let Some(kind) = detect(repo.git_dir()) else {
            return Ok(None);
        };
        Ok(Some(OperationInProgress {
            kind,
            step: step_of(repo.git_dir(), kind),
            conflicts: status::read(&repo)?.conflicts.len() as u32,
            can_skip: kind != OperationKind::Merge,
        }))
    }

    /// Finishes the operation once every conflict is resolved.
    pub fn continue_operation(&self, worktree: &Path) -> Result<MutationOutcome, ApiError> {
        self.run_operation(worktree, Action::Continue)
    }

    /// Drops the commit the operation is stopped on and goes on with the next one.
    pub fn skip_operation(&self, worktree: &Path) -> Result<MutationOutcome, ApiError> {
        self.run_operation(worktree, Action::Skip)
    }

    /// Gives up and puts the Worktree back as it was before the operation began. Confirm it
    /// through `MutationKind::AbortOperation` first.
    pub fn abort_operation(&self, worktree: &Path) -> Result<MutationOutcome, ApiError> {
        self.run_operation(worktree, Action::Abort)
    }

    fn run_operation(&self, worktree: &Path, action: Action) -> Result<MutationOutcome, ApiError> {
        let (_, repo) = open_worktree(worktree)?;
        let kind = detect(repo.git_dir()).ok_or_else(|| ApiError::Unexpected {
            message: "no merge, rebase, cherry-pick or revert is in progress".to_owned(),
        })?;
        drop(repo);

        let (verb, flag) = match action {
            Action::Continue => ("Continue", "--continue"),
            Action::Skip if kind == OperationKind::Merge => {
                return Err(ApiError::Unexpected {
                    message: "a merge cannot be skipped".to_owned(),
                })
            }
            Action::Skip => ("Skip", "--skip"),
            Action::Abort => ("Abort", "--abort"),
        };
        self.mutations.run(
            worktree,
            Mutation::new(format!("{verb} {}", kind.label()), [kind.command(), flag]),
        )
    }
}

pub(crate) fn detect(git_dir: &Path) -> Option<OperationKind> {
    if git_dir.join("rebase-merge").is_dir() || git_dir.join("rebase-apply/rebasing").exists() {
        return Some(OperationKind::Rebase);
    }
    if git_dir.join("CHERRY_PICK_HEAD").exists() {
        return Some(OperationKind::CherryPick);
    }
    if git_dir.join("REVERT_HEAD").exists() {
        return Some(OperationKind::Revert);
    }
    if git_dir.join("MERGE_HEAD").exists() {
        return Some(OperationKind::Merge);
    }
    // A range of commits stopped on a conflict leaves its remaining steps here.
    let todo = fs::read_to_string(git_dir.join("sequencer/todo")).ok()?;
    match todo.split_whitespace().next()? {
        "revert" => Some(OperationKind::Revert),
        _ => Some(OperationKind::CherryPick),
    }
}

fn step_of(git_dir: &Path, kind: OperationKind) -> Option<OperationStep> {
    if kind != OperationKind::Rebase {
        return None;
    }
    let read = |file: &str| -> Option<u32> {
        fs::read_to_string(git_dir.join(file))
            .ok()?
            .trim()
            .parse()
            .ok()
    };
    let (current, total) = match (read("rebase-merge/msgnum"), read("rebase-merge/end")) {
        (Some(current), Some(total)) => (current, total),
        _ => (read("rebase-apply/next")?, read("rebase-apply/last")?),
    };
    Some(OperationStep { current, total })
}

/// What aborting would throw away: the work done since the operation began. A rebase has
/// replayed commits onto the new base that stop being reachable once it is undone.
pub(crate) fn abort_loss(repo: &gix::Repository) -> Result<Loss, ApiError> {
    let Some(kind) = detect(repo.git_dir()) else {
        return Ok(Loss::default());
    };

    let status = status::read(repo)?;
    let files = status
        .conflicts
        .into_iter()
        .chain(status.staged)
        .chain(status.unstaged)
        .filter(|file| file.kind != status::ChangeKind::Untracked)
        .fold(Vec::new(), |mut unique, file| {
            if !unique.iter().any(|seen: &status::FileChange| seen.path == file.path) {
                unique.push(file);
            }
            unique
        });

    let (commits, unpushed_commits) = if kind == OperationKind::Rebase {
        replayed_commits(repo)?
    } else {
        (0, 0)
    };
    Ok(Loss {
        files,
        commits,
        unpushed_commits,
    })
}

/// The commits of a rebase that sit on its new base, and how many of them no remote has.
fn replayed_commits(repo: &gix::Repository) -> Result<(u32, u32), ApiError> {
    let git_dir = repo.git_dir();
    let onto_file = if git_dir.join("rebase-merge").is_dir() {
        "rebase-merge/onto"
    } else {
        "rebase-apply/onto"
    };
    let Ok(onto) = fs::read_to_string(git_dir.join(onto_file)) else {
        return Ok((0, 0));
    };
    let Ok(onto) = gix::ObjectId::from_hex(onto.trim().as_bytes()) else {
        return Ok((0, 0));
    };
    let Some(head) = repo.head_id().ok() else {
        return Ok((0, 0));
    };

    let replayed = count_unreachable_from(repo, head.detach(), vec![onto])?;
    let mut hidden: BTreeSet<gix::ObjectId> = outgoing::remote_tips(repo)?.into_iter().collect();
    hidden.insert(onto);
    let unpushed = count_unreachable_from(repo, head.detach(), hidden.into_iter().collect())?;
    Ok((replayed, unpushed))
}

fn count_unreachable_from(
    repo: &gix::Repository,
    tip: gix::ObjectId,
    hidden: Vec<gix::ObjectId>,
) -> Result<u32, ApiError> {
    let walk = repo
        .rev_walk([tip])
        .with_hidden(hidden)
        .all()
        .map_err(ApiError::unexpected)?;
    let mut count = 0;
    for info in walk {
        info.map_err(ApiError::unexpected)?;
        count += 1;
    }
    Ok(count)
}
