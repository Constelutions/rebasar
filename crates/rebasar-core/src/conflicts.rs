//! Reading a conflicted file as ours, theirs and result, and resolving it.

use std::fs;
use std::path::Path;

use gix::bstr::BStr;
use gix::index::entry::Stage;
use serde::Serialize;

use crate::diff::ensure_inside_worktree;
use crate::mutation::Mutation;
use crate::{open_worktree, ApiError, Core, MutationOutcome};

const BINARY_SNIFF_BYTES: usize = 8000;
const SYMLINK_MODE: u32 = 0o120_000;
const GITLINK_MODE: u32 = 0o160_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ConflictKind {
    /// Both sides changed the lines; resolved hunk by hunk.
    Text,
    Binary,
    /// One side deleted the file while the other changed it.
    DeleteModify,
    /// Renames and directory/file conflicts, which need the user's merge tool or the terminal.
    Unsupported,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ConflictSide {
    Ours,
    Theirs,
}

/// A stretch of the file with the conflict markers read back out of it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ConflictSegment {
    Text { text: String },
    Conflict { ours: String, theirs: String },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConflictFile {
    pub path: String,
    pub kind: ConflictKind,
    /// The file as the current branch has it; empty where it deleted it or for a binary file.
    pub ours: String,
    pub theirs: String,
    /// The file on disk, split at its conflict markers; empty unless the conflict is textual.
    pub segments: Vec<ConflictSegment>,
    /// Which side deleted the file in a delete/modify conflict.
    pub deleted_by: Option<ConflictSide>,
    /// Whether `merge.tool` is set, so an unsupported conflict can be handed to it.
    pub merge_tool_configured: bool,
}

impl Core {
    pub fn conflict_file(&self, worktree: &Path, path: &str) -> Result<ConflictFile, ApiError> {
        ensure_inside_worktree(path)?;
        let (worktree_path, repo) = open_worktree(worktree)?;
        let index = repo.index_or_empty().map_err(ApiError::unexpected)?;
        let entry = |stage| index.entry_by_path_and_stage(BStr::new(path), stage);
        let (base, ours, theirs) = (
            entry(Stage::Base),
            entry(Stage::Ours),
            entry(Stage::Theirs),
        );
        if base.is_none() && ours.is_none() && theirs.is_none() {
            return Err(ApiError::Unexpected {
                message: format!("{path} is not in conflict"),
            });
        }

        let blob = |entry: Option<&gix::index::Entry>| -> Result<Vec<u8>, ApiError> {
            match entry {
                Some(entry) => Ok(repo
                    .find_object(entry.id)
                    .map_err(ApiError::unexpected)?
                    .detach()
                    .data),
                None => Ok(Vec::new()),
            }
        };
        let (ours_bytes, theirs_bytes) = (blob(ours)?, blob(theirs)?);
        let on_disk = worktree_path.join(path);

        let special = [ours, theirs].into_iter().flatten().any(|entry| {
            matches!(entry.mode.bits() & 0o170_000, SYMLINK_MODE | GITLINK_MODE)
        });
        let kind = match (base.is_some(), ours.is_some(), theirs.is_some()) {
            _ if special || on_disk.is_dir() => ConflictKind::Unsupported,
            (true, true, false) | (true, false, true) => ConflictKind::DeleteModify,
            (_, true, true) if looks_binary(&ours_bytes) || looks_binary(&theirs_bytes) => {
                ConflictKind::Binary
            }
            (_, true, true) => ConflictKind::Text,
            _ => ConflictKind::Unsupported,
        };

        let segments = match kind {
            ConflictKind::Text => {
                let disk = fs::read(&on_disk).map_err(ApiError::unexpected)?;
                if looks_binary(&disk) {
                    Vec::new()
                } else {
                    split_at_markers(&String::from_utf8_lossy(&disk))
                }
            }
            _ => Vec::new(),
        };
        let readable = |bytes: &[u8]| {
            if looks_binary(bytes) {
                String::new()
            } else {
                String::from_utf8_lossy(bytes).into_owned()
            }
        };
        Ok(ConflictFile {
            path: path.to_owned(),
            kind,
            ours: readable(&ours_bytes),
            theirs: readable(&theirs_bytes),
            segments,
            deleted_by: match (ours.is_some(), theirs.is_some()) {
                (false, true) => Some(ConflictSide::Ours),
                (true, false) => Some(ConflictSide::Theirs),
                _ => None,
            },
            merge_tool_configured: repo.config_snapshot().string("merge.tool").is_some(),
        })
    }

    /// Saves `contents` as the resolved file and stages it, which marks it resolved.
    pub fn resolve_conflict_file(
        &self,
        worktree: &Path,
        path: &str,
        contents: &str,
    ) -> Result<MutationOutcome, ApiError> {
        ensure_inside_worktree(path)?;
        let (worktree_path, _) = open_worktree(worktree)?;
        fs::write(worktree_path.join(path), contents).map_err(ApiError::unexpected)?;
        self.mark_resolved(worktree, path)
    }

    /// Keeps one side's version of the file whole, deleting the file when that side deleted it.
    pub fn resolve_conflict_with_side(
        &self,
        worktree: &Path,
        path: &str,
        side: ConflictSide,
    ) -> Result<MutationOutcome, ApiError> {
        let conflict = self.conflict_file(worktree, path)?;
        let deleted = conflict.deleted_by == Some(side);
        if deleted {
            return self.mutations.run(
                worktree,
                Mutation::new(
                    format!("Delete {path}"),
                    ["--literal-pathspecs", "rm", "--force", "--quiet", "--", path],
                ),
            );
        }
        let flag = match side {
            ConflictSide::Ours => "--ours",
            ConflictSide::Theirs => "--theirs",
        };
        let checked_out = self.mutations.run(
            worktree,
            Mutation::new(
                format!("Keep {} for {path}", flag.trim_start_matches("--")),
                ["--literal-pathspecs", "checkout", flag, "--", path],
            ),
        )?;
        if checked_out != MutationOutcome::Succeeded {
            return Ok(checked_out);
        }
        self.mark_resolved(worktree, path)
    }

    /// Hands the file to the user's configured merge tool, which opens its own window.
    pub fn open_merge_tool(&self, worktree: &Path, path: &str) -> Result<MutationOutcome, ApiError> {
        ensure_inside_worktree(path)?;
        self.mutations.run(
            worktree,
            Mutation::new(
                format!("Merge tool for {path}"),
                ["--literal-pathspecs", "mergetool", "--no-prompt", "--", path],
            ),
        )
    }

    fn mark_resolved(&self, worktree: &Path, path: &str) -> Result<MutationOutcome, ApiError> {
        self.mutations.run(
            worktree,
            Mutation::new(
                format!("Mark {path} resolved"),
                ["--literal-pathspecs", "add", "--all", "--", path],
            ),
        )
    }
}

fn looks_binary(bytes: &[u8]) -> bool {
    bytes[..bytes.len().min(BINARY_SNIFF_BYTES)].contains(&0)
}

/// Cuts the text at `<<<<<<<`, `=======` and `>>>>>>>` lines. A `|||||||` section (the common
/// ancestor, written by `merge.conflictStyle=diff3`) is left out. Text that has no complete
/// conflict comes back as one plain segment.
pub(crate) fn split_at_markers(text: &str) -> Vec<ConflictSegment> {
    enum State {
        Outside,
        Ours,
        Base,
        Theirs,
    }
    let mut segments = Vec::new();
    let (mut plain, mut ours, mut theirs) = (String::new(), String::new(), String::new());
    let mut state = State::Outside;

    for line in text.split_inclusive('\n') {
        let marker = |prefix: &str| line.starts_with(prefix) && line[prefix.len()..].chars().next().map_or(true, |c| c == ' ' || c == '\r' || c == '\n');
        match state {
            State::Outside if marker("<<<<<<<") => {
                if !plain.is_empty() {
                    segments.push(ConflictSegment::Text {
                        text: std::mem::take(&mut plain),
                    });
                }
                state = State::Ours;
            }
            State::Outside => plain.push_str(line),
            State::Ours if marker("|||||||") => state = State::Base,
            State::Ours if marker("=======") => state = State::Theirs,
            State::Ours => ours.push_str(line),
            State::Base if marker("=======") => state = State::Theirs,
            State::Base => {}
            State::Theirs if marker(">>>>>>>") => {
                segments.push(ConflictSegment::Conflict {
                    ours: std::mem::take(&mut ours),
                    theirs: std::mem::take(&mut theirs),
                });
                state = State::Outside;
            }
            State::Theirs => theirs.push_str(line),
        }
    }
    if !matches!(state, State::Outside) {
        // The markers were edited away halfway; keep everything the file holds.
        return vec![ConflictSegment::Text {
            text: text.to_owned(),
        }];
    }
    if !plain.is_empty() {
        segments.push(ConflictSegment::Text { text: plain });
    }
    segments
}
