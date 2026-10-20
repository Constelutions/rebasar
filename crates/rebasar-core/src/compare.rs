//! Compares a commit with the files as they are on disk right now.

use std::collections::BTreeSet;
use std::path::Path;

use gix::index::entry::Stage;
use serde::Deserialize;

use crate::diff::{self, DiffContent, FileDiff, LineKind, Reader, WhitespaceMode};
use crate::status::{self, ChangeKind, FileChange};
use crate::{commit, open_worktree, ApiError, Core};

const SYMLINK_MODE: u32 = 0o120_000;

/// One file of a commit, diffed against the file on disk.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeDiffRequest {
    pub commit: String,
    pub path: String,
    #[serde(default)]
    pub load_large: bool,
}

impl Core {
    /// The tracked files whose content on disk differs from the commit, staged or not. Files
    /// Git does not track yet are left out, as `git diff <commit>` does, and a renamed file
    /// shows as one deleted and one added.
    pub fn compare_with_worktree(
        &self,
        worktree: &Path,
        commit: &str,
    ) -> Result<Vec<FileChange>, ApiError> {
        let (_, repo) = open_worktree(worktree)?;
        let work_dir = work_dir(&repo)?;
        let reader = Reader {
            repo: &repo,
            work_dir,
        };
        let commit_tree = commit::find(&repo, commit)?
            .tree()
            .map_err(ApiError::unexpected)?;

        let mut candidates = BTreeSet::new();
        let head_tree = repo
            .head_tree_id_or_empty()
            .and_then(|id| id.object())
            .map_err(ApiError::unexpected)?
            .into_tree();
        for change in repo
            .diff_tree_to_tree(&commit_tree, &head_tree, None)
            .map_err(ApiError::unexpected)?
        {
            if let Some(file) = commit::file_change(&repo, change) {
                candidates.extend(file.original_path);
                candidates.insert(file.path);
            }
        }
        let status = status::read(&repo)?;
        let uncommitted = status
            .conflicts
            .into_iter()
            .chain(status.staged)
            .chain(status.unstaged)
            .filter(|file| file.kind != ChangeKind::Untracked);
        for file in uncommitted {
            candidates.extend(file.original_path);
            candidates.insert(file.path);
        }

        let mut files = Vec::new();
        for path in candidates {
            let old = reader.tree_side(&commit_tree, &path)?;
            let indexed_mode = reader.index_side(&path, Stage::Unconflicted)?.mode;
            let new = reader.worktree_side(&path, indexed_mode)?;
            let (old_mode, new_mode) = (old.mode, new.mode);
            let diff = reader.diff_between(&path, None, old, new, false, WhitespaceMode::Show)?;
            if is_unchanged(&diff) {
                continue;
            }
            files.push(status::file_change(
                path.as_str(),
                kind_of(old_mode, new_mode),
                line_counts(&diff.content),
            ));
        }
        Ok(files)
    }

    pub fn compare_file_diff(
        &self,
        worktree: &Path,
        request: &WorktreeDiffRequest,
    ) -> Result<FileDiff, ApiError> {
        let (_, repo) = open_worktree(worktree)?;
        diff::ensure_inside_worktree(&request.path)?;
        let reader = Reader {
            repo: &repo,
            work_dir: work_dir(&repo)?,
        };
        let commit_tree = commit::find(&repo, &request.commit)?
            .tree()
            .map_err(ApiError::unexpected)?;
        let old = reader.tree_side(&commit_tree, &request.path)?;
        let indexed_mode = reader.index_side(&request.path, Stage::Unconflicted)?.mode;
        let new = reader.worktree_side(&request.path, indexed_mode)?;
        reader.diff_between(
            &request.path,
            None,
            old,
            new,
            request.load_large,
            WhitespaceMode::Show,
        )
    }
}

fn work_dir(repo: &gix::Repository) -> Result<&Path, ApiError> {
    repo.workdir().ok_or_else(|| ApiError::Unexpected {
        message: "the repository has no working tree".to_owned(),
    })
}

fn is_unchanged(diff: &FileDiff) -> bool {
    diff.mode_change.is_none() && matches!(&diff.content, DiffContent::Text { hunks } if hunks.is_empty())
}

fn kind_of(old_mode: Option<u32>, new_mode: Option<u32>) -> ChangeKind {
    match (old_mode, new_mode) {
        (None, _) => ChangeKind::Added,
        (_, None) => ChangeKind::Deleted,
        (Some(old), Some(new)) if (old == SYMLINK_MODE) != (new == SYMLINK_MODE) => {
            ChangeKind::TypeChanged
        }
        _ => ChangeKind::Modified,
    }
}

fn line_counts(content: &DiffContent) -> Option<(u32, u32)> {
    let DiffContent::Text { hunks } = content else {
        return None;
    };
    let count = |kind| {
        hunks
            .iter()
            .flat_map(|hunk| &hunk.lines)
            .filter(|line| line.kind == kind)
            .count() as u32
    };
    Some((count(LineKind::Added), count(LineKind::Removed)))
}
