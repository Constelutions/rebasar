use std::borrow::Cow;
use std::fs::{self, File};
use std::io::Read;
use std::ops::Range;
use std::path::{Component, Path, PathBuf};

use base64::Engine as _;
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
/// An image above this is reported without its data until the user asks for it, because the data
/// travels to the UI as one base64 string.
const MAX_IMAGE_BYTES: u64 = 5 * 1024 * 1024;
const IMAGE_EXTENSIONS: [&str; 7] = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "ico"];
/// Enough leading bytes to tell every supported image format apart.
const IMAGE_SNIFF_BYTES: usize = 12;
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
    /// An added, modified or deleted image: a side is `None` where the file does not exist.
    Image {
        old: Option<ImageSide>,
        new: Option<ImageSide>,
    },
    /// Too big to compute without being asked; `lines` is known only when the content was read.
    Collapsed { bytes: u64, lines: Option<u32> },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageSide {
    pub mime: String,
    pub bytes: u64,
    /// Base64 of the file; `None` when it is over the size cap and was not asked for.
    pub data: Option<String>,
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
        ImageData::Include,
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
        ImageData::Include,
    )
}

pub(crate) fn ensure_inside_worktree(path: &str) -> Result<(), ApiError> {
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

pub(crate) enum Source {
    Missing,
    Blob(gix::ObjectId),
    WorktreeFile(PathBuf),
}

pub(crate) struct Side {
    pub(crate) mode: Option<u32>,
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
    Image(LoadedImage),
    TooLarge(u64),
}

/// How a side is read, decided by the caller before any bytes are looked at.
#[derive(Clone, Copy)]
struct Loading {
    /// Reads what would otherwise be collapsed or withheld.
    large: bool,
    /// The path has an image extension, so the content is checked for an image signature.
    may_be_image: bool,
}

/// Whether the data of an image comes along with its diff. A listing only needs to know that
/// the file changed, so it skips reading and encoding it.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum ImageData {
    Include,
    Omit,
}

struct LoadedImage {
    mime: &'static str,
    bytes: u64,
    content: ImageContent,
}

/// A worktree file stays unread until its diff turns out to be an image diff that wants it.
enum ImageContent {
    Bytes(Vec<u8>),
    File(PathBuf),
    Withheld,
}

impl LoadedImage {
    fn new(mime: &'static str, bytes: u64, loading: Loading, content: impl FnOnce() -> ImageContent) -> Self {
        let content = if bytes <= MAX_IMAGE_BYTES || loading.large {
            content()
        } else {
            ImageContent::Withheld
        };
        Self { mime, bytes, content }
    }

    fn into_side(self, data: ImageData) -> Result<ImageSide, ApiError> {
        let data = match (data, self.content) {
            (ImageData::Omit, _) | (_, ImageContent::Withheld) => None,
            (ImageData::Include, ImageContent::Bytes(bytes)) => Some(bytes),
            (ImageData::Include, ImageContent::File(file)) => {
                Some(fs::read(file).map_err(ApiError::unexpected)?)
            }
        };
        Ok(ImageSide {
            mime: self.mime.to_owned(),
            bytes: self.bytes,
            data: data.map(|data| base64::engine::general_purpose::STANDARD.encode(data)),
        })
    }
}

impl Loaded {
    fn bytes(&self) -> Option<u64> {
        match self {
            Loaded::Missing => None,
            Loaded::Text(data) => Some(data.len() as u64),
            Loaded::Image(image) => Some(image.bytes),
            Loaded::Binary(bytes) | Loaded::TooLarge(bytes) => Some(*bytes),
        }
    }
}

pub(crate) struct Reader<'repo> {
    pub(crate) repo: &'repo gix::Repository,
    pub(crate) work_dir: &'repo Path,
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

    pub(crate) fn diff_between(
        &self,
        path: &str,
        original_path: Option<&str>,
        old: Side,
        new: Side,
        load_large: bool,
        whitespace: WhitespaceMode,
        image_data: ImageData,
    ) -> Result<FileDiff, ApiError> {
        let (old_mode, new_mode) = (old.mode, new.mode);
        let loading = Loading {
            large: load_large,
            may_be_image: has_image_extension(path),
        };
        let old = self.load(&old.source, loading)?;
        let new = self.load(&new.source, loading)?;

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
            content: content_between(old, new, load_large, whitespace, image_data)?,
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

    pub(crate) fn tree_side(&self, tree: &gix::Tree<'_>, path: &str) -> Result<Side, ApiError> {
        let entry = tree
            .lookup_entry_by_path(path)
            .map_err(ApiError::unexpected)?;
        Ok(entry.map_or(Side::MISSING, |entry| Side {
            mode: Some(u32::from(entry.mode().value())),
            source: Source::Blob(entry.object_id()),
        }))
    }

    pub(crate) fn index_side(&self, path: &str, stage: Stage) -> Result<Side, ApiError> {
        let index = self.repo.index_or_empty().map_err(ApiError::unexpected)?;
        let entry = index.entry_by_path_and_stage(BStr::new(path), stage);
        Ok(entry.map_or(Side::MISSING, |entry| Side {
            mode: Some(entry.mode.bits()),
            source: Source::Blob(entry.id),
        }))
    }

    pub(crate) fn worktree_side(&self, path: &str, indexed_mode: Option<u32>) -> Result<Side, ApiError> {
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
        let bytes = match self.load(
            &side.source,
            Loading {
                large: true,
                may_be_image: false,
            },
        )? {
            Loaded::Missing => Vec::new(),
            Loaded::Text(data) => data,
            Loaded::Binary(_) | Loaded::Image(_) | Loaded::TooLarge(_) => {
                return Err(unsupported(path, "a binary file"))
            }
        };
        Ok(RawSide {
            bytes,
            mode: side.mode,
        })
    }

    fn load(&self, source: &Source, loading: Loading) -> Result<Loaded, ApiError> {
        match source {
            Source::Missing => Ok(Loaded::Missing),
            Source::Blob(id) => {
                let data = self
                    .repo
                    .find_object(*id)
                    .map_err(ApiError::unexpected)?
                    .detach()
                    .data;
                Ok(classify(data, loading))
            }
            Source::WorktreeFile(file) => read_worktree_file(file, loading),
        }
    }
}

fn unsupported(path: &str, what: &str) -> ApiError {
    ApiError::Unexpected {
        message: format!("{path} is {what}, so single lines cannot be staged"),
    }
}

fn classify(data: Vec<u8>, loading: Loading) -> Loaded {
    let bytes = data.len() as u64;
    if let Some(mime) = loading.may_be_image.then(|| sniff_image(&data)).flatten() {
        return Loaded::Image(LoadedImage::new(mime, bytes, loading, || {
            ImageContent::Bytes(data)
        }));
    }
    if looks_binary(&data) {
        Loaded::Binary(bytes)
    } else if bytes > MAX_DIFF_BYTES && !loading.large {
        Loaded::TooLarge(bytes)
    } else {
        Loaded::Text(data)
    }
}

fn read_worktree_file(file: &Path, loading: Loading) -> Result<Loaded, ApiError> {
    let metadata = fs::symlink_metadata(file).map_err(ApiError::unexpected)?;
    if metadata.is_symlink() {
        let target = fs::read_link(file).map_err(ApiError::unexpected)?;
        return Ok(Loaded::Text(
            target.to_string_lossy().into_owned().into_bytes(),
        ));
    }
    let bytes = metadata.len();
    if loading.may_be_image {
        let prefix = read_prefix(file, IMAGE_SNIFF_BYTES)?;
        if let Some(mime) = sniff_image(&prefix) {
            return Ok(Loaded::Image(LoadedImage::new(mime, bytes, loading, || {
                ImageContent::File(file.to_owned())
            })));
        }
    }
    if bytes > MAX_DIFF_BYTES && !loading.large {
        // Only the start is needed to tell a huge binary from a huge text file.
        let prefix = read_prefix(file, BINARY_SNIFF_BYTES)?;
        return Ok(if looks_binary(&prefix) {
            Loaded::Binary(bytes)
        } else {
            Loaded::TooLarge(bytes)
        });
    }
    Ok(classify(
        fs::read(file).map_err(ApiError::unexpected)?,
        Loading {
            may_be_image: false,
            ..loading
        },
    ))
}

fn read_prefix(file: &Path, length: usize) -> Result<Vec<u8>, ApiError> {
    let mut prefix = Vec::with_capacity(length);
    File::open(file)
        .map_err(ApiError::unexpected)?
        .take(length as u64)
        .read_to_end(&mut prefix)
        .map_err(ApiError::unexpected)?;
    Ok(prefix)
}

fn has_image_extension(path: &str) -> bool {
    Path::new(path)
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            IMAGE_EXTENSIONS
                .iter()
                .any(|image| extension.eq_ignore_ascii_case(image))
        })
}

fn sniff_image(bytes: &[u8]) -> Option<&'static str> {
    match bytes {
        [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, ..] => Some("image/png"),
        [0xFF, 0xD8, 0xFF, ..] => Some("image/jpeg"),
        [b'G', b'I', b'F', b'8', ..] => Some("image/gif"),
        [b'R', b'I', b'F', b'F', _, _, _, _, b'W', b'E', b'B', b'P', ..] => Some("image/webp"),
        [b'B', b'M', ..] => Some("image/bmp"),
        [0, 0, 1, 0, ..] => Some("image/x-icon"),
        _ => None,
    }
}

fn looks_binary(bytes: &[u8]) -> bool {
    bytes[..bytes.len().min(BINARY_SNIFF_BYTES)].contains(&0)
}

fn content_between(
    old: Loaded,
    new: Loaded,
    load_large: bool,
    whitespace: WhitespaceMode,
    image_data: ImageData,
) -> Result<DiffContent, ApiError> {
    let is_binary = |side: &Loaded| matches!(side, Loaded::Binary(_) | Loaded::Image(_));
    if is_binary(&old) || is_binary(&new) {
        let is_picture = |side: &Loaded| matches!(side, Loaded::Missing | Loaded::Image(_));
        if is_picture(&old) && is_picture(&new) {
            return Ok(DiffContent::Image {
                old: image_side(old, image_data)?,
                new: image_side(new, image_data)?,
            });
        }
        return Ok(DiffContent::Binary {
            old_bytes: old.bytes(),
            new_bytes: new.bytes(),
        });
    }
    let too_large = [&old, &new]
        .into_iter()
        .any(|side| matches!(side, Loaded::TooLarge(_)));
    if too_large {
        let bytes = old.bytes().max(new.bytes()).unwrap_or_default();
        return Ok(DiffContent::Collapsed { bytes, lines: None });
    }

    let old = text_of(old);
    let new = text_of(new);
    let lines = count_lines(&old).max(count_lines(&new));
    if lines > MAX_DIFF_LINES && !load_large {
        return Ok(DiffContent::Collapsed {
            bytes: (old.len().max(new.len())) as u64,
            lines: Some(lines as u32),
        });
    }
    Ok(DiffContent::Text {
        hunks: hunks_between(&old, &new, whitespace),
    })
}

fn image_side(loaded: Loaded, data: ImageData) -> Result<Option<ImageSide>, ApiError> {
    match loaded {
        Loaded::Image(image) => image.into_side(data).map(Some),
        _ => Ok(None),
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
