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
        .map(|pending: &Pending| pending.change.path.clone())
        .collect();
    // The tree-to-index diff also reports the stage-0-less entries of an unmerged path.
    staged.retain(|pending| !conflicted.contains(&pending.change.path));
    for list in [&mut conflicts, &mut staged, &mut unstaged] {
        list.sort_by(|a, b| a.change.path.cmp(&b.change.path));
    }
    let shared = repo.clone().into_sync();
    for list in [&mut staged, &mut unstaged] {
        count_lines(&shared, &work_dir, list);
    }
    Ok(WorktreeStatus {
        conflicts: into_changes(conflicts),
        staged: into_changes(staged),
        unstaged: into_changes(unstaged),
    })
}

/// How a change's line counts are worked out. Listing the changes only records this; the work
/// itself is the expensive part of a status and runs afterwards, across threads.
enum Counting {
    Unavailable,
    /// All lines of the blob, as removed.
    Removed(gix::ObjectId),
    /// All lines of the blob, as added.
    Added(gix::ObjectId),
    /// All lines of the file on disk, as added.
    Untracked(BString),
    AgainstWorktree(gix::ObjectId, BString),
    BetweenBlobs(gix::ObjectId, gix::ObjectId),
}

struct Pending {
    change: FileChange,
    counting: Counting,
}

fn into_changes(list: Vec<Pending>) -> Vec<FileChange> {
    list.into_iter().map(|pending| pending.change).collect()
}

/// Below this many changes the cost of starting threads outweighs the counting itself.
const MIN_CHANGES_PER_THREAD: usize = 64;

fn count_lines(shared: &gix::ThreadSafeRepository, work_dir: &Path, list: &mut [Pending]) {
    let threads = std::thread::available_parallelism()
        .map_or(1, |threads| threads.get())
        .min(list.len() / MIN_CHANGES_PER_THREAD)
        .max(1);
    if threads == 1 {
        count_chunk(&shared.to_thread_local(), work_dir, list);
        return;
    }
    let chunk_len = list.len().div_ceil(threads);
    std::thread::scope(|scope| {
        for chunk in list.chunks_mut(chunk_len) {
            scope.spawn(|| count_chunk(&shared.to_thread_local(), work_dir, chunk));
        }
    });
}

fn count_chunk(repo: &gix::Repository, work_dir: &Path, chunk: &mut [Pending]) {
    let reader = Reader { repo, work_dir };
    for pending in chunk {
        let counts = reader.count(&pending.counting);
        pending.change.added = counts.map(|(added, _)| added);
        pending.change.removed = counts.map(|(_, removed)| removed);
    }
}

struct Reader<'repo> {
    repo: &'repo gix::Repository,
    work_dir: &'repo Path,
}

impl Reader<'_> {
    fn collect_index_worktree(
        &self,
        item: IndexWorktreeItem,
        conflicts: &mut Vec<Pending>,
        unstaged: &mut Vec<Pending>,
    ) {
        match item {
            IndexWorktreeItem::Modification {
                entry,
                rela_path,
                status,
                ..
            } => match status {
                EntryStatus::Conflict { .. } => {
                    conflicts.push(pending_change(
                        &rela_path,
                        ChangeKind::Conflicted,
                        Counting::Unavailable,
                    ));
                }
                EntryStatus::Change(WorktreeChange::Removed) => {
                    unstaged.push(pending_change(
                        &rela_path,
                        ChangeKind::Deleted,
                        Counting::Removed(entry.id),
                    ));
                }
                EntryStatus::Change(WorktreeChange::Type { .. }) => {
                    unstaged.push(pending_change(
                        &rela_path,
                        ChangeKind::TypeChanged,
                        Counting::Unavailable,
                    ));
                }
                EntryStatus::Change(WorktreeChange::Modification { .. }) => {
                    let counting = Counting::AgainstWorktree(entry.id, rela_path.clone());
                    unstaged.push(pending_change(&rela_path, ChangeKind::Modified, counting));
                }
                _ => {}
            },
            IndexWorktreeItem::DirectoryContents { entry, .. } => {
                if entry.status != DirStatus::Untracked
                    || entry.disk_kind == Some(DiskKind::Directory)
                {
                    return;
                }
                let counting = Counting::Untracked(entry.rela_path.clone());
                unstaged.push(pending_change(
                    &entry.rela_path,
                    ChangeKind::Untracked,
                    counting,
                ));
            }
            IndexWorktreeItem::Rewrite { .. } => {}
        }
    }

    fn tree_index_change(&self, change: TreeIndexChange) -> Pending {
        match change {
            TreeIndexChange::Addition { location, id, .. } => pending_change(
                &location,
                ChangeKind::Added,
                Counting::Added(id.into_owned()),
            ),
            TreeIndexChange::Deletion { location, id, .. } => pending_change(
                &location,
                ChangeKind::Deleted,
                Counting::Removed(id.into_owned()),
            ),
            TreeIndexChange::Modification {
                location,
                previous_id,
                id,
                ..
            } => pending_change(
                &location,
                ChangeKind::Modified,
                Counting::BetweenBlobs(previous_id.into_owned(), id.into_owned()),
            ),
            TreeIndexChange::Rewrite {
                source_location,
                source_id,
                location,
                id,
                copy,
                ..
            } => {
                let counting = Counting::BetweenBlobs(source_id.into_owned(), id.into_owned());
                if copy {
                    pending_change(&location, ChangeKind::Added, counting)
                } else {
                    let mut renamed = pending_change(&location, ChangeKind::Renamed, counting);
                    renamed.change.original_path = Some(path_string(&source_location));
                    renamed
                }
            }
        }
    }

    fn count(&self, counting: &Counting) -> Option<(u32, u32)> {
        match counting {
            Counting::Unavailable => None,
            Counting::Removed(id) => self.blob(id).map(|old| (0, line_count(&old))),
            Counting::Added(id) => self.blob(id).map(|new| (line_count(&new), 0)),
            Counting::Untracked(rela_path) => self
                .worktree_file(rela_path)
                .map(|new| (line_count(&new), 0)),
            Counting::AgainstWorktree(old, rela_path) => {
                let old = self.blob(old)?;
                let new = self.worktree_file(rela_path)?;
                Some(diff_counts(&old, &new))
            }
            Counting::BetweenBlobs(old, new) => {
                let old = self.blob(old)?;
                let new = self.blob(new)?;
                Some(diff_counts(&old, &new))
            }
        }
    }

    fn blob(&self, id: &gix::oid) -> Option<Vec<u8>> {
        countable_blob(self.repo, id)
    }

    fn worktree_file(&self, rela_path: impl AsRef<BStr>) -> Option<Vec<u8>> {
        let path = self.work_dir.join(rela_path.as_ref().to_path().ok()?);
        if std::fs::symlink_metadata(&path).ok()?.is_symlink() {
            return None;
        }
        let bytes = std::fs::read(path).ok()?;
        (bytes.len() <= MAX_COUNTED_BYTES && !looks_binary(&bytes)).then_some(bytes)
    }
}

fn pending_change(path: impl AsRef<BStr>, kind: ChangeKind, counting: Counting) -> Pending {
    Pending {
        change: file_change(path, kind, None),
        counting,
    }
}

/// `None` for a blob that is missing, binary or too big to count lines in.
pub(crate) fn countable_blob(repo: &gix::Repository, id: &gix::oid) -> Option<Vec<u8>> {
    let blob = repo.find_object(id).ok()?.detach().data;
    (blob.len() <= MAX_COUNTED_BYTES && !looks_binary(&blob)).then_some(blob)
}

pub(crate) fn file_change(
    path: impl AsRef<BStr>,
    kind: ChangeKind,
    counts: Option<(u32, u32)>,
) -> FileChange {
    FileChange {
        path: path_string(path),
        original_path: None,
        kind,
        added: counts.map(|(added, _)| added),
        removed: counts.map(|(_, removed)| removed),
    }
}

pub(crate) fn path_string(path: impl AsRef<BStr>) -> String {
    path.as_ref().to_str_lossy().into_owned()
}

fn looks_binary(bytes: &[u8]) -> bool {
    bytes[..bytes.len().min(BINARY_SNIFF_BYTES)].contains(&0)
}

pub(crate) fn line_count(bytes: &[u8]) -> u32 {
    let newlines = bytes.iter().filter(|&&byte| byte == b'\n').count();
    let unterminated = bytes.last().is_some_and(|&byte| byte != b'\n');
    (newlines + usize::from(unterminated)) as u32
}

/// Returns `(added, removed)`. Line endings are normalised first because the index holds LF
/// while a Windows checkout with `core.autocrlf` holds CRLF, which would otherwise make every
/// line look changed.
pub(crate) fn diff_counts(old: &[u8], new: &[u8]) -> (u32, u32) {
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
