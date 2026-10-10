use gix::bstr::ByteSlice;
use gix::diff::tree_with_rewrites::Change;
use serde::Serialize;

use crate::status::{self, ChangeKind, FileChange};
use crate::{open_worktree, ApiError, Core};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitDetail {
    pub id: String,
    pub short_id: String,
    pub author_name: String,
    pub author_email: String,
    /// Seconds since the Unix epoch.
    pub author_timestamp: i64,
    /// Everything after the commit's headers, without the trailing newline.
    pub message: String,
    pub parents: Vec<CommitParent>,
    /// The files that differ from the parent the commit was read against, by path.
    pub files: Vec<FileChange>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitParent {
    pub id: String,
    pub short_id: String,
    pub subject: String,
}

impl Core {
    /// Describes a commit and lists the files it changed against its `parent`-th parent. A root
    /// commit has no parent, so it is compared with the empty tree whatever `parent` is.
    pub fn commit_detail(
        &self,
        worktree_path: &std::path::Path,
        commit: &str,
        parent: usize,
    ) -> Result<CommitDetail, ApiError> {
        let (_, repo) = open_worktree(worktree_path)?;
        let commit = find(&repo, commit)?;
        let new_tree = commit.tree().map_err(ApiError::unexpected)?;
        let old_tree = parent_tree(&repo, &commit, parent)?;

        let changes = repo
            .diff_tree_to_tree(&old_tree, &new_tree, None)
            .map_err(ApiError::unexpected)?;
        let mut files: Vec<FileChange> = changes
            .into_iter()
            .filter_map(|change| file_change(&repo, change))
            .collect();
        files.sort_by(|a, b| a.path.cmp(&b.path));

        let author = commit.author().map_err(ApiError::unexpected)?;
        let message = commit.message_raw_sloppy().to_str_lossy();
        let mut parents = Vec::new();
        for id in commit.parent_ids() {
            let subject = repo
                .find_commit(id)
                .map_err(ApiError::unexpected)?
                .message()
                .map_err(ApiError::unexpected)?
                .summary()
                .to_string();
            parents.push(CommitParent {
                id: id.to_string(),
                short_id: id.to_hex_with_len(SHORT_ID_LENGTH).to_string(),
                subject,
            });
        }

        Ok(CommitDetail {
            id: commit.id.to_string(),
            short_id: commit.id.to_hex_with_len(SHORT_ID_LENGTH).to_string(),
            author_name: author.name.to_string(),
            author_email: author.email.to_string(),
            author_timestamp: author.seconds(),
            message: message.trim_end().to_owned(),
            parents,
            files,
        })
    }
}

const SHORT_ID_LENGTH: usize = 7;

pub(crate) fn find<'repo>(
    repo: &'repo gix::Repository,
    id: &str,
) -> Result<gix::Commit<'repo>, ApiError> {
    let id = gix::ObjectId::from_hex(id.as_bytes()).map_err(|_| ApiError::Unexpected {
        message: format!("{id} is not a commit id"),
    })?;
    repo.find_commit(id).map_err(ApiError::unexpected)
}

/// The empty tree for a root commit.
pub(crate) fn parent_tree<'repo>(
    repo: &'repo gix::Repository,
    commit: &gix::Commit<'repo>,
    parent: usize,
) -> Result<gix::Tree<'repo>, ApiError> {
    let parent_ids: Vec<_> = commit.parent_ids().collect();
    if parent_ids.is_empty() {
        return Ok(repo.empty_tree());
    }
    let id = parent_ids.get(parent).ok_or_else(|| ApiError::Unexpected {
        message: format!(
            "commit {} has no parent number {parent}",
            commit.id.to_hex_with_len(SHORT_ID_LENGTH)
        ),
    })?;
    repo.find_commit(*id)
        .and_then(|parent| parent.tree())
        .map_err(ApiError::unexpected)
}

fn file_change(repo: &gix::Repository, change: Change) -> Option<FileChange> {
    let counts = |old: Option<&gix::oid>, new: Option<&gix::oid>| -> Option<(u32, u32)> {
        let old = match old {
            Some(id) => status::countable_blob(repo, id)?,
            None => Vec::new(),
        };
        let new = match new {
            Some(id) => status::countable_blob(repo, id)?,
            None => Vec::new(),
        };
        Some(status::diff_counts(&old, &new))
    };

    match change {
        Change::Addition {
            location,
            entry_mode,
            id,
            ..
        } if entry_mode.is_blob_or_symlink() => Some(status::file_change(
            &location,
            ChangeKind::Added,
            counts(None, Some(&id)),
        )),
        Change::Deletion {
            location,
            entry_mode,
            id,
            ..
        } if entry_mode.is_blob_or_symlink() => Some(status::file_change(
            &location,
            ChangeKind::Deleted,
            counts(Some(&id), None),
        )),
        Change::Modification {
            location,
            previous_entry_mode,
            entry_mode,
            previous_id,
            id,
            ..
        } if entry_mode.is_blob_or_symlink() && previous_entry_mode.is_blob_or_symlink() => {
            let kind = if entry_mode.kind() == previous_entry_mode.kind() {
                ChangeKind::Modified
            } else {
                ChangeKind::TypeChanged
            };
            Some(status::file_change(
                &location,
                kind,
                counts(Some(&previous_id), Some(&id)),
            ))
        }
        Change::Rewrite {
            source_location,
            source_id,
            location,
            id,
            copy,
            ..
        } => {
            let counts = counts(Some(&source_id), Some(&id));
            Some(if copy {
                status::file_change(&location, ChangeKind::Added, counts)
            } else {
                FileChange {
                    original_path: Some(status::path_string(&source_location)),
                    ..status::file_change(&location, ChangeKind::Renamed, counts)
                }
            })
        }
        _ => None,
    }
}
