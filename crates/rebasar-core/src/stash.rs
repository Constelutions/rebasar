//! Stashes: listing them, previewing what is in one, and parking or restoring work.

use std::path::Path;

use gix::bstr::ByteSlice;
use serde::Serialize;

use crate::mutation::Mutation;
use crate::safety::Loss;
use crate::status::FileChange;
use crate::{commit, open_worktree, ApiError, Core, MutationOutcome};

const SHORT_ID_LENGTH: usize = 7;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StashInfo {
    /// The stash commit. Every action names a stash by this, so a stash that was added or
    /// dropped since the list was read can never be mistaken for another.
    pub id: String,
    pub short_id: String,
    /// What the user typed, or Git's own `WIP on main: abc1234 subject`.
    pub message: String,
    /// The branch it was made on; empty when Git did not record one.
    pub branch: String,
    /// Seconds since the Unix epoch.
    pub timestamp: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StashPreview {
    /// The tracked files the stash changes, as they differ from where it was made.
    pub files: Vec<FileChange>,
    /// Files that were untracked when the stash was made.
    pub untracked: Vec<String>,
}

impl Core {
    /// Newest first.
    pub fn list_stashes(&self, worktree: &Path) -> Result<Vec<StashInfo>, ApiError> {
        let (_, repo) = open_worktree(worktree)?;
        stashes_of(&repo)
    }

    /// What the stash holds, for previewing; its diffs are read like those of any commit, with
    /// [`Core::commit_file_diff`] against parent 0.
    pub fn stash_preview(&self, worktree: &Path, stash: &str) -> Result<StashPreview, ApiError> {
        let (_, repo) = open_worktree(worktree)?;
        find(&repo, stash)?;
        let detail = commit::detail(&repo, stash, 0)?;

        let found = commit::find(&repo, stash)?;
        let untracked = match found.parent_ids().nth(2) {
            Some(parent) => {
                let tree = repo
                    .find_commit(parent)
                    .map_err(ApiError::unexpected)?
                    .tree()
                    .map_err(ApiError::unexpected)?;
                let mut paths = Vec::new();
                let mut recorder = gix::traverse::tree::Recorder::default();
                tree.traverse()
                    .breadthfirst(&mut recorder)
                    .map_err(ApiError::unexpected)?;
                for entry in recorder.records {
                    if entry.mode.is_blob() {
                        paths.push(entry.filepath.to_str_lossy().into_owned());
                    }
                }
                paths.sort();
                paths
            }
            None => Vec::new(),
        };
        Ok(StashPreview {
            files: detail.files,
            untracked,
        })
    }

    /// Parks the uncommitted changes. Files Git does not track yet go with them only when
    /// `include_untracked` is set. Does nothing, successfully, when there is nothing to park.
    pub fn stash_changes(
        &self,
        worktree: &Path,
        message: Option<&str>,
        include_untracked: bool,
    ) -> Result<MutationOutcome, ApiError> {
        let mut args = vec!["stash".to_owned(), "push".to_owned()];
        if include_untracked {
            args.push("--include-untracked".to_owned());
        }
        if let Some(message) = message.map(str::trim).filter(|message| !message.is_empty()) {
            args.extend(["--message".to_owned(), message.to_owned()]);
        }
        self.mutations
            .run(worktree, Mutation::new("Stash changes", args))
    }

    /// Applies the stash and keeps it. A conflict leaves conflicted files for the Conflicts view.
    pub fn apply_stash(&self, worktree: &Path, stash: &str) -> Result<MutationOutcome, ApiError> {
        self.run_on_stash(worktree, stash, "apply", "Apply")
    }

    /// Applies the stash and drops it once that worked; a conflict keeps it.
    pub fn pop_stash(&self, worktree: &Path, stash: &str) -> Result<MutationOutcome, ApiError> {
        self.run_on_stash(worktree, stash, "pop", "Pop")
    }

    /// Throws the stash away. Confirm through `MutationKind::DropStash` first.
    pub fn drop_stash(&self, worktree: &Path, stash: &str) -> Result<MutationOutcome, ApiError> {
        self.run_on_stash(worktree, stash, "drop", "Drop")
    }

    fn run_on_stash(
        &self,
        worktree: &Path,
        stash: &str,
        command: &str,
        verb: &str,
    ) -> Result<MutationOutcome, ApiError> {
        let (_, repo) = open_worktree(worktree)?;
        let index = index_of(&repo, stash)?;
        drop(repo);
        self.mutations.run(
            worktree,
            Mutation::new(
                format!("{verb} stash {}", &stash[..SHORT_ID_LENGTH.min(stash.len())]),
                vec!["stash".to_owned(), command.to_owned(), format!("stash@{{{index}}}")],
            ),
        )
    }
}

/// The tracked files the stash holds, which dropping it would lose.
pub(crate) fn drop_loss(repo: &gix::Repository, stash: &str) -> Result<Loss, ApiError> {
    index_of(repo, stash)?;
    let detail = crate::commit::detail(repo, stash, 0)?;
    Ok(Loss {
        files: detail.files,
        ..Loss::default()
    })
}

fn stashes_of(repo: &gix::Repository) -> Result<Vec<StashInfo>, ApiError> {
    let Some(reference) = repo
        .try_find_reference("refs/stash")
        .map_err(ApiError::unexpected)?
    else {
        return Ok(Vec::new());
    };
    let mut platform = reference.log_iter();
    let Some(lines) = platform.rev().map_err(ApiError::unexpected)? else {
        return Ok(Vec::new());
    };

    let mut stashes = Vec::new();
    for line in lines {
        let line = line.map_err(ApiError::unexpected)?;
        let id = line.new_oid;
        let found = repo.find_commit(id).map_err(ApiError::unexpected)?;
        let message = line.message.to_str_lossy().into_owned();
        stashes.push(StashInfo {
            id: id.to_string(),
            short_id: id.to_hex_with_len(SHORT_ID_LENGTH).to_string(),
            branch: branch_of(&message),
            message,
            timestamp: found
                .time()
                .map(|time| time.seconds)
                .map_err(ApiError::unexpected)?,
        });
    }
    Ok(stashes)
}

/// `WIP on main: abc subject` and `On main: custom message` both name the branch.
fn branch_of(message: &str) -> String {
    let rest = message
        .strip_prefix("WIP on ")
        .or_else(|| message.strip_prefix("On "));
    rest.and_then(|rest| rest.split_once(':'))
        .map(|(branch, _)| branch.to_owned())
        .unwrap_or_default()
}

fn index_of(repo: &gix::Repository, stash: &str) -> Result<usize, ApiError> {
    stashes_of(repo)?
        .iter()
        .position(|candidate| candidate.id == stash)
        .ok_or_else(|| ApiError::Unexpected {
            message: "that stash no longer exists".to_owned(),
        })
}

fn find(repo: &gix::Repository, stash: &str) -> Result<(), ApiError> {
    index_of(repo, stash).map(drop)
}
