use std::borrow::Cow;
use std::fs::{self, File};
use std::io::Read;
use std::ops::Range;
use std::path::{Component, Path, PathBuf};

use gix::bstr::BStr;
use gix::diff::blob::{Algorithm, Diff, InternedInput};
use gix::index::entry::Stage;
use serde::{Deserialize, Serialize};

use crate::{commit, ApiError};

/// A file above either limit is collapsed until the user asks for it, so one huge file cannot
/// freeze the view.
const MAX_DIFF_BYTES: u64 = 1024 * 1024;
const MAX_DIFF_LINES: usize = 20_000;
const BINARY_SNIFF_BYTES: usize = 8000;
const CONTEXT_LINES: u32 = 3;

const SYMLINK_MODE: u32 = 0o120_000;
const REGULAR_MODE: u32 = 0o100_644;

/// Which of the three lists of a Worktree status the file was picked from; it decides what the
/// two sides of the diff are.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ChangeList {
    /// The version in the merge's first parent against the file with its conflict markers.
    Conflicts,
    /// The last commit against the index.
    Staged,
    /// The index against the file on disk.
    Unstaged,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffRequest {
    pub path: String,
    /// Where a staged rename came from, as reported by the status.
    #[serde(default)]
    pub original_path: Option<String>,
    pub list: ChangeList,
    /// Computes the diff of a file that would otherwise come back collapsed.
    #[serde(default)]
    pub load_large: bool,
    #[serde(default)]
    pub whitespace: WhitespaceMode,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum WhitespaceMode {
    /// Lines that differ only in whitespace count as changed.
    #[default]
    Show,
    /// Lines that differ only in whitespace count as unchanged, like `git diff -w`.
    IgnoreAll,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileDiff {
    pub path: String,
    pub original_path: Option<String>,
    pub mode_change: Option<ModeChange>,
    pub content: DiffContent,
}

/// File modes as Git prints them, in octal: `100644`, `100755`, `120000`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModeChange {
    pub old: String,
    pub new: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum DiffContent {
    /// Empty when only the name or the mode changed.
    Text { hunks: Vec<Hunk> },
    Binary {
        old_bytes: Option<u64>,
        new_bytes: Option<u64>,
    },
    /// Too big to compute without being asked; `lines` is known only when the content was read.
    Collapsed { bytes: u64, lines: Option<u32> },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Hunk {
    pub old_start: u32,
    pub old_lines: u32,
    pub new_start: u32,
    pub new_lines: u32,
    pub lines: Vec<DiffLine>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffLine {
    pub kind: LineKind,
    pub old_number: Option<u32>,
    pub new_number: Option<u32>,
    pub text: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LineKind {
    Context,
    Added,
    Removed,
}

pub(crate) fn read(repo: &gix::Repository, request: &DiffRequest) -> Result<FileDiff, ApiError> {
    let work_dir = repo.workdir().ok_or_else(|| ApiError::Unexpected {
        message: "the repository has no working tree".to_owned(),
    })?;
    ensure_inside_worktree(&request.path)?;
    if let Some(original) = &request.original_path {
        ensure_inside_worktree(original)?;
    }

    let reader = Reader { repo, work_dir };
    let (old, new) = reader.sides(request)?;
    reader.diff_between(
        &request.path,
        request.original_path.as_deref(),
        old,
        new,
        request.load_large,
        request.whitespace,
    )
}

/// One side of a file exactly as stored, line endings included.
pub(crate) struct RawSide {
    pub bytes: Vec<u8>,
    pub mode: Option<u32>,
}

impl RawSide {
    pub fn exists(&self) -> bool {
        self.mode.is_some()
    }
}

/// The two sides of the diff for `request`, for building a patch from them. Binary files and
/// symlinks have no lines to pick, so they are refused.
pub(crate) fn read_sides(
    repo: &gix::Repository,
    request: &DiffRequest,
) -> Result<(RawSide, RawSide), ApiError> {
    let work_dir = repo.workdir().ok_or_else(|| ApiError::Unexpected {
        message: "the repository has no working tree".to_owned(),
    })?;
    ensure_inside_worktree(&request.path)?;
    if let Some(original) = &request.original_path {
        ensure_inside_worktree(original)?;
    }

    let reader = Reader { repo, work_dir };
    let (old, new) = reader.sides(request)?;
    Ok((
        reader.raw_side(old, &request.path)?,
        reader.raw_side(new, &request.path)?,
    ))
}

/// One file of a commit, diffed against the commit's `parent`-th parent.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitDiffRequest {
    pub commit: String,
    /// Index into the commit's parents; ignored for a root commit, which has none.
    pub parent: usize,
    pub path: String,
    /// Where a renamed file came from, as reported by the commit's file list.
    #[serde(default)]
    pub original_path: Option<String>,
    #[serde(default)]
    pub load_large: bool,
}

pub(crate) fn read_in_commit(
    repo: &gix::Repository,
    request: &CommitDiffRequest,
) -> Result<FileDiff, ApiError> {
    ensure_inside_worktree(&request.path)?;
    if let Some(original) = &request.original_path {
        ensure_inside_worktree(original)?;
    }

    let commit = commit::find(repo, &request.commit)?;
    let new_tree = commit.tree().map_err(ApiError::unexpected)?;
    let old_tree = commit::parent_tree(repo, &commit, request.parent)?;

    // Both sides are blobs of the commit, so nothing is read from the Worktree.
    let reader = Reader {
        repo,
        work_dir: Path::new(""),
    };
    let old_path = request.original_path.as_deref().unwrap_or(&request.path);
    reader.diff_between(
        &request.path,
        request.original_path.as_deref(),
        reader.tree_side(&old_tree, old_path)?,
        reader.tree_side(&new_tree, &request.path)?,
        request.load_large,
        WhitespaceMode::Show,
    )
}

fn ensure_inside_worktree(path: &str) -> Result<(), ApiError> {
    let inside = Path::new(path)
        .components()
        .all(|component| matches!(component, Component::Normal(_)));
    if inside && !path.is_empty() {
        return Ok(());
    }
    Err(ApiError::Unexpected {
        message: format!("{path} is not a path inside the Worktree"),
    })
}

enum Source {
    Missing,
    Blob(gix::ObjectId),
    WorktreeFile(PathBuf),
}

struct Side {
    mode: Option<u32>,
    source: Source,
}

impl Side {
    const MISSING: Side = Side {
        mode: None,
        source: Source::Missing,
    };
}

enum Loaded {
    Missing,
    Text(Vec<u8>),
    Binary(u64),
    TooLarge(u64),
}

impl Loaded {
    fn bytes(&self) -> Option<u64> {
        match self {
            Loaded::Missing => None,
            Loaded::Text(data) => Some(data.len() as u64),
            Loaded::Binary(bytes) | Loaded::TooLarge(bytes) => Some(*bytes),
        }
    }
}

struct Reader<'repo> {
    repo: &'repo gix::Repository,
    work_dir: &'repo Path,
}

impl Reader<'_> {
    fn sides(&self, request: &DiffRequest) -> Result<(Side, Side), ApiError> {
        let path = request.path.as_str();
        Ok(match request.list {
            ChangeList::Staged => {
                let old_path = request.original_path.as_deref().unwrap_or(path);
                (
                    self.head_side(old_path)?,
                    self.index_side(path, Stage::Unconflicted)?,
                )
            }
            ChangeList::Unstaged => {
                let index = self.index_side(path, Stage::Unconflicted)?;
                let worktree = self.worktree_side(path, index.mode)?;
                (index, worktree)
            }
            ChangeList::Conflicts => {
                let ours = self.index_side(path, Stage::Ours)?;
                let worktree = self.worktree_side(path, ours.mode)?;
                (ours, worktree)
            }
        })
    }

    fn diff_between(
        &self,
        path: &str,
        original_path: Option<&str>,
        old: Side,
        new: Side,
        load_large: bool,
        whitespace: WhitespaceMode,
    ) -> Result<FileDiff, ApiError> {
        let (old_mode, new_mode) = (old.mode, new.mode);
        let old = self.load(&old.source, load_large)?;
        let new = self.load(&new.source, load_large)?;

        Ok(FileDiff {
            path: path.to_owned(),
            original_path: original_path.map(str::to_owned),
            mode_change: match (old_mode, new_mode) {
                (Some(old), Some(new)) if old != new => Some(ModeChange {
                    old: format!("{old:o}"),
                    new: format!("{new:o}"),
                }),
                _ => None,
            },
            content: content_between(old, new, load_large, whitespace),
        })
    }

    fn head_side(&self, path: &str) -> Result<Side, ApiError> {
        let tree = self
            .repo
            .head_tree_id_or_empty()
            .map_err(ApiError::unexpected)?
            .object()
            .map_err(ApiError::unexpected)?
            .into_tree();
        self.tree_side(&tree, path)
    }

    fn tree_side(&self, tree: &gix::Tree<'_>, path: &str) -> Result<Side, ApiError> {
        let entry = tree
            .lookup_entry_by_path(path)
            .map_err(ApiError::unexpected)?;
        Ok(entry.map_or(Side::MISSING, |entry| Side {
            mode: Some(u32::from(entry.mode().value())),
            source: Source::Blob(entry.object_id()),
        }))
    }

    fn index_side(&self, path: &str, stage: Stage) -> Result<Side, ApiError> {
        let index = self.repo.index_or_empty().map_err(ApiError::unexpected)?;
        let entry = index.entry_by_path_and_stage(BStr::new(path), stage);
        Ok(entry.map_or(Side::MISSING, |entry| Side {
            mode: Some(entry.mode.bits()),
            source: Source::Blob(entry.id),
        }))
    }

    fn worktree_side(&self, path: &str, indexed_mode: Option<u32>) -> Result<Side, ApiError> {
        let file = self.work_dir.join(path);
        let Ok(metadata) = fs::symlink_metadata(&file) else {
            return Ok(Side::MISSING);
        };
        // Windows has no executable bit to read from disk, so a mode change only ever shows once
        // it is staged: on disk the file keeps the mode the index gives it.
        let mode = if metadata.is_symlink() {
            SYMLINK_MODE
        } else {
            indexed_mode
                .filter(|&mode| mode != SYMLINK_MODE)
                .unwrap_or(REGULAR_MODE)
        };
        Ok(Side {
            mode: Some(mode),
            source: Source::WorktreeFile(file),
        })
    }

    fn raw_side(&self, side: Side, path: &str) -> Result<RawSide, ApiError> {
        if side.mode == Some(SYMLINK_MODE) {
            return Err(unsupported(path, "a symbolic link"));
        }
        let bytes = match self.load(&side.source, true)? {
            Loaded::Missing => Vec::new(),
            Loaded::Text(data) => data,
            Loaded::Binary(_) | Loaded::TooLarge(_) => {
                return Err(unsupported(path, "a binary file"))
            }
        };
        Ok(RawSide {
            bytes,
            mode: side.mode,
        })
    }

    fn load(&self, source: &Source, load_large: bool) -> Result<Loaded, ApiError> {
        match source {
            Source::Missing => Ok(Loaded::Missing),
            Source::Blob(id) => {
                let data = self
                    .repo
                    .find_object(*id)
                    .map_err(ApiError::unexpected)?
                    .detach()
                    .data;
                Ok(classify(data, load_large))
            }
            Source::WorktreeFile(file) => read_worktree_file(file, load_large),
        }
    }
}

fn unsupported(path: &str, what: &str) -> ApiError {
    ApiError::Unexpected {
        message: format!("{path} is {what}, so single lines cannot be staged"),
    }
}

fn classify(data: Vec<u8>, load_large: bool) -> Loaded {
    let bytes = data.len() as u64;
    if looks_binary(&data) {
        Loaded::Binary(bytes)
    } else if bytes > MAX_DIFF_BYTES && !load_large {
        Loaded::TooLarge(bytes)
    } else {
        Loaded::Text(data)
    }
}

fn read_worktree_file(file: &Path, load_large: bool) -> Result<Loaded, ApiError> {
    let metadata = fs::symlink_metadata(file).map_err(ApiError::unexpected)?;
    if metadata.is_symlink() {
        let target = fs::read_link(file).map_err(ApiError::unexpected)?;
        return Ok(Loaded::Text(
            target.to_string_lossy().into_owned().into_bytes(),
        ));
    }
    let bytes = metadata.len();
    if bytes > MAX_DIFF_BYTES && !load_large {
        // Only the start is needed to tell a huge binary from a huge text file.
        let mut prefix = Vec::with_capacity(BINARY_SNIFF_BYTES);
        File::open(file)
            .map_err(ApiError::unexpected)?
            .take(BINARY_SNIFF_BYTES as u64)
            .read_to_end(&mut prefix)
            .map_err(ApiError::unexpected)?;
        return Ok(if looks_binary(&prefix) {
            Loaded::Binary(bytes)
        } else {
            Loaded::TooLarge(bytes)
        });
    }
    Ok(classify(
        fs::read(file).map_err(ApiError::unexpected)?,
        load_large,
    ))
}

fn looks_binary(bytes: &[u8]) -> bool {
    bytes[..bytes.len().min(BINARY_SNIFF_BYTES)].contains(&0)
}

fn content_between(
    old: Loaded,
    new: Loaded,
    load_large: bool,
    whitespace: WhitespaceMode,
) -> DiffContent {
    if matches!(old, Loaded::Binary(_)) || matches!(new, Loaded::Binary(_)) {
        return DiffContent::Binary {
            old_bytes: old.bytes(),
            new_bytes: new.bytes(),
        };
    }
    let too_large = [&old, &new]
        .into_iter()
        .any(|side| matches!(side, Loaded::TooLarge(_)));
    if too_large {
        let bytes = old.bytes().max(new.bytes()).unwrap_or_default();
        return DiffContent::Collapsed { bytes, lines: None };
    }

    let old = text_of(old);
    let new = text_of(new);
    let lines = count_lines(&old).max(count_lines(&new));
    if lines > MAX_DIFF_LINES && !load_large {
        return DiffContent::Collapsed {
            bytes: (old.len().max(new.len())) as u64,
            lines: Some(lines as u32),
        };
    }
    DiffContent::Text {
        hunks: hunks_between(&old, &new, whitespace),
    }
}

/// Line endings are normalised because the index holds LF while a Windows checkout with
/// `core.autocrlf` holds CRLF, which would otherwise make every line look changed.
fn text_of(loaded: Loaded) -> Vec<u8> {
    let Loaded::Text(data) = loaded else {
        return Vec::new();
    };
    normalise_line_endings(&data)
}

fn normalise_line_endings(data: &[u8]) -> Vec<u8> {
    let mut normalised = Vec::with_capacity(data.len());
    for (index, &byte) in data.iter().enumerate() {
        let before_newline = data.get(index + 1) == Some(&b'\n');
        if byte != b'\r' || !before_newline {
            normalised.push(byte);
        }
    }
    normalised
}

fn count_lines(bytes: &[u8]) -> usize {
    split_lines(bytes).count()
}

pub(crate) fn split_lines(bytes: &[u8]) -> impl Iterator<Item = &[u8]> {
    bytes.split_inclusive(|&byte| byte == b'\n')
}

pub(crate) struct Change {
    pub before: Range<u32>,
    pub after: Range<u32>,
}

pub(crate) fn changes_between(old: &[u8], new: &[u8]) -> Vec<Change> {
    changes_by(old, new, WhitespaceMode::Show)
}

/// The same changes the diff view shows, found with line endings normalised, as ranges of
/// the raw lines of both sides.
pub(crate) fn displayed_changes(old: &[u8], new: &[u8]) -> Vec<Change> {
    changes_between(&normalise_line_endings(old), &normalise_line_endings(new))
}

fn changes_by(old: &[u8], new: &[u8], whitespace: WhitespaceMode) -> Vec<Change> {
    let mut input = InternedInput::default();
    input.update_before(comparable_lines(old, whitespace));
    input.update_after(comparable_lines(new, whitespace));
    Diff::compute(Algorithm::Histogram, &input)
        .hunks()
        .map(|hunk| Change {
            before: hunk.before,
            after: hunk.after,
        })
        .collect()
}

fn hunks_between(old: &[u8], new: &[u8], whitespace: WhitespaceMode) -> Vec<Hunk> {
    let changes = changes_by(old, new, whitespace);
    if changes.is_empty() {
        return Vec::new();
    }

    let old_lines: Vec<&[u8]> = split_lines(old).collect();
    let new_lines: Vec<&[u8]> = split_lines(new).collect();
    group_changes(&changes, old_lines.len() as u32)
        .into_iter()
        .map(|group| build_hunk(group, &old_lines, &new_lines))
        .collect()
}

/// What each line is compared by; the text shown is always the original line.
fn comparable_lines(
    bytes: &[u8],
    whitespace: WhitespaceMode,
) -> impl Iterator<Item = Cow<'_, [u8]>> {
    split_lines(bytes).map(move |line| match whitespace {
        WhitespaceMode::Show => Cow::Borrowed(line),
        WhitespaceMode::IgnoreAll => Cow::Owned(
            line.iter()
                .copied()
                .filter(|byte| !byte.is_ascii_whitespace())
                .collect(),
        ),
    })
}

/// Neighbouring changes share a hunk when the unchanged lines between them fit in the context
/// shown around both.
fn group_changes(changes: &[Change], old_len: u32) -> Vec<Group<'_>> {
    let mut groups: Vec<Group> = Vec::new();
    let mut previous_end = 0;
    for change in changes {
        let gap = change.before.start - previous_end;
        match groups.last_mut() {
            Some(group) if gap <= 2 * CONTEXT_LINES => group.changes.push(change),
            _ => groups.push(Group {
                leading: gap.min(CONTEXT_LINES),
                trailing: 0,
                changes: vec![change],
            }),
        }
        previous_end = change.before.end;
    }
    for group in &mut groups {
        let last = group.changes.last().expect("a group has a change");
        group.trailing = (old_len - last.before.end).min(CONTEXT_LINES);
    }
    groups
}

struct Group<'a> {
    leading: u32,
    trailing: u32,
    changes: Vec<&'a Change>,
}

fn build_hunk(group: Group<'_>, old_lines: &[&[u8]], new_lines: &[&[u8]]) -> Hunk {
    let first = group.changes[0];
    let old_first = first.before.start - group.leading;
    let new_first = first.after.start - group.leading;

    let mut lines = Vec::new();
    let mut old_cursor = old_first;
    let mut new_cursor = new_first;
    for change in &group.changes {
        let unchanged = change.before.start - old_cursor;
        lines.extend(context_lines(old_lines, old_cursor, new_cursor, unchanged));
        for index in change.before.clone() {
            lines.push(DiffLine {
                kind: LineKind::Removed,
                old_number: Some(index + 1),
                new_number: None,
                text: line_text(old_lines[index as usize]),
            });
        }
        for index in change.after.clone() {
            lines.push(DiffLine {
                kind: LineKind::Added,
                old_number: None,
                new_number: Some(index + 1),
                text: line_text(new_lines[index as usize]),
            });
        }
        old_cursor = change.before.end;
        new_cursor = change.after.end;
    }
    lines.extend(context_lines(
        old_lines,
        old_cursor,
        new_cursor,
        group.trailing,
    ));
    old_cursor += group.trailing;
    new_cursor += group.trailing;

    let old_count = old_cursor - old_first;
    let new_count = new_cursor - new_first;
    Hunk {
        // Git numbers an empty range by the line before it.
        old_start: if old_count == 0 {
            old_first
        } else {
            old_first + 1
        },
        old_lines: old_count,
        new_start: if new_count == 0 {
            new_first
        } else {
            new_first + 1
        },
        new_lines: new_count,
        lines,
    }
}

fn context_lines<'a>(
    old_lines: &'a [&[u8]],
    old_first: u32,
    new_first: u32,
    count: u32,
) -> impl Iterator<Item = DiffLine> + 'a {
    (0..count).map(move |offset| DiffLine {
        kind: LineKind::Context,
        old_number: Some(old_first + offset + 1),
        new_number: Some(new_first + offset + 1),
        text: line_text(old_lines[(old_first + offset) as usize]),
    })
}

/// A line as the diff view shows it, with a CRLF ending read as LF.
pub(crate) fn displayed_text(line: &[u8]) -> String {
    line_text(&normalise_line_endings(line))
}

fn line_text(line: &[u8]) -> String {
    let line = line.strip_suffix(b"\n").unwrap_or(line);
    String::from_utf8_lossy(line).into_owned()
}
