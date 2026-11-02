//! The confirmation policy: the one place that decides which Mutations can lose work.
//!
//! Adding a Mutation that can lose work means adding a [`MutationKind`] variant and deciding
//! it in [`assess`]; the exhaustive `match` there makes the compiler refuse anything left
//! unclassified. See `docs/confirmation-policy.md`.

use std::collections::BTreeSet;

use serde::{Deserialize, Serialize};

use crate::status::{self, FileChange};
use crate::ApiError;

/// A Mutation the user is about to request. A variant carries whatever is needed to work out
/// what it would lose, and nothing else.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum MutationKind {
    Stage,
    Unstage,
    Commit,
    /// Throws away the unstaged changes to these files, untracked files included.
    DiscardChanges {
        paths: Vec<String>,
    },
    /// Gives up the merge, rebase, cherry-pick or revert Git is paused in.
    AbortOperation,
    /// Replaces the remote branch with the local one, dropping commits only the remote has.
    ForcePush,
    /// Deletes a local branch, with the commits only it holds.
    DeleteBranch {
        name: String,
    },
    /// Deletes a branch on a remote, with the commits only it reaches. Everyone sharing that
    /// remote loses the branch too.
    DeleteRemoteBranch {
        remote: String,
        name: String,
    },
    /// Moves the current branch to a commit; may drop commits and, when hard, uncommitted work.
    /// Throws a stash away, with the work parked in it.
    DropStash {
        stash: String,
    },
    /// Removes a linked Worktree with whatever is uncommitted in it.
    RemoveWorktree {
        path: String,
    },
    /// Deletes a tag here, with the commits only it reaches.
    DeleteTag {
        name: String,
    },
    /// Deletes a tag on a remote. Nothing local is lost, so this is safe to run; it is still a
    /// kind of its own so the UI can ask the question the user would expect.
    DeleteRemoteTag {
        name: String,
        remote: String,
    },
    Reset {
        commit: String,
        mode: crate::commit_actions::ResetMode,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum Assessment {
    Safe,
    Destructive { loss: Loss },
}

/// Exactly what a destructive Mutation would lose, as it stands right now.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Loss {
    /// Files with uncommitted work that would be overwritten or deleted.
    pub files: Vec<FileChange>,
    /// Commits that would no longer be reachable from any branch.
    pub commits: u32,
    /// How many of those commits exist on no remote, so nobody else has a copy.
    pub unpushed_commits: u32,
    /// The newest of those commits, for a dialog that names them. Empty for a Mutation whose
    /// loss is not worth listing.
    pub commit_list: Vec<LostCommit>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LostCommit {
    pub short_id: String,
    pub subject: String,
}

impl Loss {
    pub fn is_empty(&self) -> bool {
        self.files.is_empty() && self.commits == 0
    }
}

pub(crate) fn assess(repo: &gix::Repository, kind: &MutationKind) -> Result<Assessment, ApiError> {
    let loss = match kind {
        MutationKind::AbortOperation => crate::operation::abort_loss(repo)?,
        MutationKind::ForcePush => crate::sync::force_push_loss(repo)?,
        MutationKind::DeleteBranch { name } => crate::branches::delete_loss(repo, name)?,
        MutationKind::DeleteRemoteBranch { remote, name } => {
            crate::branches::delete_remote_loss(repo, remote, name)?
        }
        MutationKind::DeleteTag { name } => crate::tags_remotes::delete_tag_loss(repo, name)?,
        MutationKind::DeleteRemoteTag { .. } => return Ok(Assessment::Safe),
        MutationKind::RemoveWorktree { path } => crate::worktrees::remove_loss(path)?,
        MutationKind::DropStash { stash } => crate::stash::drop_loss(repo, stash)?,
        MutationKind::Reset { commit, mode } => {
            crate::commit_actions::reset_loss(repo, commit, *mode)?
        }
        MutationKind::Stage | MutationKind::Unstage | MutationKind::Commit => {
            return Ok(Assessment::Safe);
        }
        MutationKind::DiscardChanges { paths } => Loss {
            files: discardable(repo, paths)?,
            ..Loss::default()
        },
    };
    // A destructive Mutation that would lose nothing has nothing to confirm.
    Ok(if loss.is_empty() {
        Assessment::Safe
    } else {
        Assessment::Destructive { loss }
    })
}

/// The unstaged entries among `paths`. Conflicted files are left out because discarding them
/// is a resolution choice, and staged changes are left out because they are not unstaged work.
pub(crate) fn discardable(
    repo: &gix::Repository,
    paths: &[String],
) -> Result<Vec<FileChange>, ApiError> {
    let wanted: BTreeSet<&str> = paths.iter().map(String::as_str).collect();
    Ok(status::read(repo)?
        .unstaged
        .into_iter()
        .filter(|change| wanted.contains(change.path.as_str()))
        .collect())
}
