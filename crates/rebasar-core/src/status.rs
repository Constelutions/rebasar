use std::collections::BTreeSet;
use std::path::Path;

use gix::bstr::{BStr, BString, ByteSlice};
use gix::diff::blob::{Algorithm, Diff, InternedInput};
use gix::diff::index::Change as TreeIndexChange;
use gix::dir::entry::{Kind as DiskKind, Status as DirStatus};
use gix::status::index_worktree::Item as IndexWorktreeItem;
use gix::status::plumbing::index_as_worktree::{Change as WorktreeChange, EntryStatus};
use gix::status::{Item, UntrackedFiles};
use serde::Serialize;

use crate::ApiError;

/// Files above this size are listed without line counts so one huge file cannot stall a refresh.
const MAX_COUNTED_BYTES: usize = 1024 * 1024;
const BINARY_SNIFF_BYTES: usize = 8000;

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeStatus {
    pub conflicts: Vec<FileChange>,
    pub staged: Vec<FileChange>,
    pub unstaged: Vec<FileChange>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileChange {
    pub path: String,
    pub original_path: Option<String>,
    pub kind: ChangeKind,
    /// `None` for binary, oversized and symlink content, which has no meaningful line counts.
    pub added: Option<u32>,
    pub removed: Option<u32>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ChangeKind {
    Added,
    Modified,
    Deleted,
    Renamed,
    TypeChanged,
    Untracked,
    Conflicted,
}

pub(crate) fn read(repo: &gix::Repository) -> Result<WorktreeStatus, ApiError> {
    let work_dir = repo
        .workdir()
        .ok_or_else(|| ApiError::Unexpected {
            message: "the repository has no working tree".to_owned(),
        })?
        .to_owned();
    let reader = Reader {
        repo,
        work_dir: &work_dir,
    };

    let platform = repo
        .status(gix::progress::Discard)
        .map_err(ApiError::unexpected)?
        .untracked_files(UntrackedFiles::Files)
        .index_worktree_submodules(None);
    let items = platform
        .into_iter(Vec::<BString>::new())
        .map_err(ApiError::unexpected)?;

    let mut conflicts = Vec::new();
    let mut staged = Vec::new();
    let mut unstaged = Vec::new();
    for item in items {
        match item.map_err(ApiError::unexpected)? {
            Item::IndexWorktree(item) => {
                reader.collect_index_worktree(item, &mut conflicts, &mut unstaged)
            }
            Item::TreeIndex(change) => staged.push(reader.tree_index_change(change)),
        }
    }

    let conflicted: BTreeSet<_> = conflicts
        .iter()
        .map(|c: &FileChange| c.path.clone())
        .collect();
    // The tree-to-index diff also reports the stage-0-less entries of an unmerged path.
    staged.retain(|change| !conflicted.contains(&change.path));
    for list in [&mut conflicts, &mut staged, &mut unstaged] {
        list.sort_by(|a, b| a.path.cmp(&b.path));
    }
    Ok(WorktreeStatus {
        conflicts,
        staged,
        unstaged,
    })
}

struct Reader<'repo> {
    repo: &'repo gix::Repository,
    work_dir: &'repo Path,
}

impl Reader<'_> {
    fn collect_index_worktree(
        &self,
        item: IndexWorktreeItem,
        conflicts: &mut Vec<FileChange>,
        unstaged: &mut Vec<FileChange>,
    ) {
        match item {
            IndexWorktreeItem::Modification {
                entry,
                rela_path,
                status,
                ..
            } => match status {
                EntryStatus::Conflict { .. } => {
                    conflicts.push(file_change(&rela_path, ChangeKind::Conflicted, None));
                }
                EntryStatus::Change(WorktreeChange::Removed) => {
                    let counts = self.blob(&entry.id).map(|old| (0, line_count(&old)));
                    unstaged.push(file_change(&rela_path, ChangeKind::Deleted, counts));
                }
                EntryStatus::Change(WorktreeChange::Type { .. }) => {
                    unstaged.push(file_change(&rela_path, ChangeKind::TypeChanged, None));
                }
                EntryStatus::Change(WorktreeChange::Modification { .. }) => {
                    let counts = self.counts_against_worktree(&entry.id, &rela_path);
                    unstaged.push(file_change(&rela_path, ChangeKind::Modified, counts));
                }
                _ => {}
            },
            IndexWorktreeItem::DirectoryContents { entry, .. } => {
                if entry.status != DirStatus::Untracked
                    || entry.disk_kind == Some(DiskKind::Directory)
                {
                    return;
                }
                let counts = self
                    .worktree_file(&entry.rela_path)
                    .map(|new| (line_count(&new), 0));
                unstaged.push(file_change(&entry.rela_path, ChangeKind::Untracked, counts));
            }
            IndexWorktreeItem::Rewrite { .. } => {}
        }
    }

    fn tree_index_change(&self, change: TreeIndexChange) -> FileChange {
        match change {
            TreeIndexChange::Addition { location, id, .. } => {
                let counts = self.blob(&id).map(|new| (line_count(&new), 0));
                file_change(&location, ChangeKind::Added, counts)
            }
            TreeIndexChange::Deletion { location, id, .. } => {
                let counts = self.blob(&id).map(|old| (0, line_count(&old)));
                file_change(&location, ChangeKind::Deleted, counts)
            }
            TreeIndexChange::Modification {
                location,
                previous_id,
                id,
                ..
            } => {
                let counts = self.counts_between_blobs(&previous_id, &id);
                file_change(&location, ChangeKind::Modified, counts)
            }
            TreeIndexChange::Rewrite {
                source_location,
                source_id,
                location,
                id,
                copy,
                ..
            } => {
                let counts = self.counts_between_blobs(&source_id, &id);
                if copy {
                    file_change(&location, ChangeKind::Added, counts)
                } else {
                    FileChange {
                        original_path: Some(path_string(&source_location)),
                        ..file_change(&location, ChangeKind::Renamed, counts)
                    }
                }
            }
        }
    }

    fn blob(&self, id: &gix::oid) -> Option<Vec<u8>> {
        let blob = self.repo.find_object(id).ok()?.detach().data;
        (blob.len() <= MAX_COUNTED_BYTES && !looks_binary(&blob)).then_some(blob)
    }

    fn worktree_file(&self, rela_path: impl AsRef<BStr>) -> Option<Vec<u8>> {
        let path = self.work_dir.join(rela_path.as_ref().to_path().ok()?);
        if std::fs::symlink_metadata(&path).ok()?.is_symlink() {
            return None;
        }
        let bytes = std::fs::read(path).ok()?;
        (bytes.len() <= MAX_COUNTED_BYTES && !looks_binary(&bytes)).then_some(bytes)
    }

    fn counts_between_blobs(&self, old: &gix::oid, new: &gix::oid) -> Option<(u32, u32)> {
        let old = self.blob(old)?;
        let new = self.blob(new)?;
        Some(diff_counts(&old, &new))
    }

    fn counts_against_worktree(
        &self,
        old: &gix::oid,
        rela_path: impl AsRef<BStr>,
    ) -> Option<(u32, u32)> {
        let old = self.blob(old)?;
        let new = self.worktree_file(rela_path)?;
        Some(diff_counts(&old, &new))
    }
}

fn file_change(path: impl AsRef<BStr>, kind: ChangeKind, counts: Option<(u32, u32)>) -> FileChange {
    FileChange {
        path: path_string(path),
        original_path: None,
        kind,
        added: counts.map(|(added, _)| added),
        removed: counts.map(|(_, removed)| removed),
    }
}

fn path_string(path: impl AsRef<BStr>) -> String {
    path.as_ref().to_str_lossy().into_owned()
}

fn looks_binary(bytes: &[u8]) -> bool {
    bytes[..bytes.len().min(BINARY_SNIFF_BYTES)].contains(&0)
}

fn line_count(bytes: &[u8]) -> u32 {
    let newlines = bytes.iter().filter(|&&byte| byte == b'\n').count();
    let unterminated = bytes.last().is_some_and(|&byte| byte != b'\n');
    (newlines + usize::from(unterminated)) as u32
}

/// Returns `(added, removed)`. Line endings are normalised first because the index holds LF
/// while a Windows checkout with `core.autocrlf` holds CRLF, which would otherwise make every
/// line look changed.
fn diff_counts(old: &[u8], new: &[u8]) -> (u32, u32) {
    if old.is_empty() {
        return (line_count(new), 0);
    }
    if new.is_empty() {
        return (0, line_count(old));
    }
    let old = without_carriage_returns(old);
    let new = without_carriage_returns(new);
    let input = InternedInput::new(old.as_slice(), new.as_slice());
    let diff = Diff::compute(Algorithm::Histogram, &input);
    (diff.count_additions(), diff.count_removals())
}

fn without_carriage_returns(bytes: &[u8]) -> Vec<u8> {
    let mut normalised = Vec::with_capacity(bytes.len());
    for (index, &byte) in bytes.iter().enumerate() {
        let before_newline = bytes.get(index + 1) == Some(&b'\n');
        if byte != b'\r' || !before_newline {
            normalised.push(byte);
        }
    }
    normalised
}
