//! The safe operations offered on a commit in History. Each runs as a mutation.

use std::path::Path;

use crate::mutation::Mutation;
use crate::{open_worktree, ApiError, Core, MutationOutcome};

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
