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
    /// Moves the current branch to a commit; may drop commits and, when hard, uncommitted work.
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
