//! Stages and unstages single lines by handing `git apply --cached` a patch that rewrites the
//! indexed file into the wanted content.

use std::collections::HashMap;

use serde::Deserialize;

use crate::diff::{
    changes_between, displayed_changes, displayed_text, read_sides, split_lines, ChangeList, DiffLine,
    DiffRequest, LineKind, RawSide,
};
use crate::ApiError;

const REGULAR_MODE: u32 = 0o100_644;

/// The lines picked in the diff of one file. Picking every changed line of a hunk stages or
/// unstages that hunk.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LineSelection {
    pub path: String,
    /// Where a staged rename came from, as reported by the status.
    #[serde(default)]
    pub original_path: Option<String>,
    /// Added and removed lines exactly as the diff showed them.
    pub lines: Vec<DiffLine>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Direction {
    Stage,
    Unstage,
}

/// `None` when the selection would leave the index as it is.
pub(crate) fn patch_for(
    repo: &gix::Repository,
    selection: &LineSelection,
    direction: Direction,
) -> Result<Option<Vec<u8>>, ApiError> {
    let request = DiffRequest {
        path: selection.path.clone(),
        original_path: selection.original_path.clone(),
        list: match direction {
            Direction::Stage => ChangeList::Unstaged,
            Direction::Unstage => ChangeList::Staged,
        },
        load_large: true,
        whitespace: Default::default(),
    };
    let (old, new) = read_sides(repo, &request)?;
    let picked = Picked::resolve(&old, &new, selection)?;

    let (indexed, wanted, target) = match direction {
        Direction::Stage => (&old, picked.stage_into(&old, &new), &new),
        Direction::Unstage => (&new, picked.unstage_from(&old, &new), &old),
    };
    let creation_mode = match direction {
        Direction::Stage => new.mode,
        Direction::Unstage => old.mode,
    };

    Ok(file_patch(
        &selection.path,
        indexed,
        &wanted,
        target,
        creation_mode,
    ))
}

/// The changed lines the selection names, as indexes into the raw lines of both sides.
struct Picked {
    changes: Vec<crate::diff::Change>,
    removed: Vec<bool>,
    added: Vec<bool>,
}

impl Picked {
    fn resolve(old: &RawSide, new: &RawSide, selection: &LineSelection) -> Result<Self, ApiError> {
        let changes = displayed_changes(&old.bytes, &new.bytes);
        let old_lines: Vec<&[u8]> = split_lines(&old.bytes).collect();
        let new_lines: Vec<&[u8]> = split_lines(&new.bytes).collect();

        let mut wanted: HashMap<(LineKind, u32), &str> = HashMap::new();
        for line in &selection.lines {
            let number = match line.kind {
                LineKind::Removed => line.old_number,
                LineKind::Added => line.new_number,
                LineKind::Context => None,
            };
            let number = number.ok_or_else(|| ApiError::Unexpected {
                message: "only added and removed lines can be staged".to_owned(),
            })?;
            wanted.insert((line.kind, number), line.text.as_str());
        }

        let mut removed = vec![false; old_lines.len()];
        let mut added = vec![false; new_lines.len()];
        let mut matched = 0;
        for change in &changes {
            for index in change.before.clone() {
                let text = displayed_text(old_lines[index as usize]);
                if wanted.get(&(LineKind::Removed, index + 1)) == Some(&text.as_str()) {
                    removed[index as usize] = true;
                    matched += 1;
                }
            }
            for index in change.after.clone() {
                let text = displayed_text(new_lines[index as usize]);
                if wanted.get(&(LineKind::Added, index + 1)) == Some(&text.as_str()) {
                    added[index as usize] = true;
                    matched += 1;
                }
            }
        }
        if matched != wanted.len() {
            return Err(ApiError::Unexpected {
                message: format!(
                    "{} changed since its diff was shown; select the lines again",
                    selection.path
                ),
            });
        }
        Ok(Self {
            changes,
            removed,
            added,
        })
    }

    /// The indexed content with the picked changes of the working tree added to it.
    fn stage_into(&self, old: &RawSide, new: &RawSide) -> Vec<u8> {
        let old_lines: Vec<&[u8]> = split_lines(&old.bytes).collect();
        let new_lines: Vec<&[u8]> = split_lines(&new.bytes).collect();
        // A working tree on CRLF is committed as LF unless the index already uses CRLF.
        let strip_carriage_returns = !old.bytes.is_empty() && !contains_crlf(&old.bytes);

        let mut wanted = Vec::new();
        let mut position = 0;
        for change in &self.changes {
            extend(
                &mut wanted,
                &old_lines[position..change.before.start as usize],
            );
            for index in change.before.clone() {
                if !self.removed[index as usize] {
                    push_content_line(&mut wanted, old_lines[index as usize]);
                }
            }
            for index in change.after.clone() {
                if self.added[index as usize] {
                    let line = new_lines[index as usize];
                    if strip_carriage_returns {
                        push_content_line(&mut wanted, &without_carriage_return(line));
                    } else {
                        push_content_line(&mut wanted, line);
                    }
                }
            }
            position = change.before.end as usize;
        }
        extend(&mut wanted, &old_lines[position..]);
        wanted
    }

    /// The indexed content with the picked changes of the last commit put back.
    fn unstage_from(&self, old: &RawSide, new: &RawSide) -> Vec<u8> {
        let old_lines: Vec<&[u8]> = split_lines(&old.bytes).collect();
        let new_lines: Vec<&[u8]> = split_lines(&new.bytes).collect();

        let mut wanted = Vec::new();
        let mut position = 0;
        for change in &self.changes {
            extend(
                &mut wanted,
                &new_lines[position..change.after.start as usize],
            );
            for index in change.before.clone() {
                if self.removed[index as usize] {
                    push_content_line(&mut wanted, old_lines[index as usize]);
                }
            }
            for index in change.after.clone() {
                if !self.added[index as usize] {
                    push_content_line(&mut wanted, new_lines[index as usize]);
                }
            }
            position = change.after.end as usize;
        }
        extend(&mut wanted, &new_lines[position..]);
        wanted
    }
}

fn extend(into: &mut Vec<u8>, lines: &[&[u8]]) {
    for line in lines {
        push_content_line(into, line);
    }
}

/// Only the last line of a file may lack its newline, so one that is followed by more lines
/// gets it.
fn push_content_line(into: &mut Vec<u8>, line: &[u8]) {
    if !into.is_empty() && !into.ends_with(b"\n") {
        into.push(b'\n');
    }
    into.extend_from_slice(line);
}

fn contains_crlf(bytes: &[u8]) -> bool {
    bytes.windows(2).any(|pair| pair == b"\r\n")
}

fn without_carriage_return(line: &[u8]) -> Vec<u8> {
    match line.strip_suffix(b"\r\n") {
        Some(content) => [content, b"\n"].concat(),
        None => line.to_vec(),
    }
}

/// A patch that turns `indexed` into `wanted`, as one hunk spanning the whole file so that Git
/// refuses it if the index moved on since the selection was read.
fn file_patch(
    path: &str,
    indexed: &RawSide,
    wanted: &[u8],
    target: &RawSide,
    creation_mode: Option<u32>,
) -> Option<Vec<u8>> {
    if indexed.bytes == wanted {
        return None;
    }
    let removes_file = wanted.is_empty() && !target.exists();
    let before = quote_path(&format!("a/{path}"));
    let after = quote_path(&format!("b/{path}"));
    let mut patch = format!("diff --git {before} {after}\n").into_bytes();
    let header = match (indexed.exists(), removes_file) {
        (false, _) => format!(
            "new file mode {:o}\n--- /dev/null\n+++ {after}\n",
            creation_mode.unwrap_or(REGULAR_MODE)
        ),
        (true, true) => format!(
            "deleted file mode {:o}\n--- {before}\n+++ /dev/null\n",
            indexed.mode.unwrap_or(REGULAR_MODE)
        ),
        (true, false) => format!("--- {before}\n+++ {after}\n"),
    };
    patch.extend(header.bytes());

    let old_lines: Vec<&[u8]> = split_lines(&indexed.bytes).collect();
    let new_lines: Vec<&[u8]> = split_lines(wanted).collect();
    patch.extend(
        format!(
            "@@ -{},{} +{},{} @@\n",
            start_of(old_lines.len()),
            old_lines.len(),
            start_of(new_lines.len()),
            new_lines.len()
        )
        .bytes(),
    );

    let mut position = 0;
    for change in changes_between(&indexed.bytes, wanted) {
        for line in &old_lines[position..change.before.start as usize] {
            push_line(&mut patch, b' ', line);
        }
        for index in change.before.clone() {
            push_line(&mut patch, b'-', old_lines[index as usize]);
        }
        for index in change.after.clone() {
            push_line(&mut patch, b'+', new_lines[index as usize]);
        }
        position = change.before.end as usize;
    }
    for line in &old_lines[position..] {
        push_line(&mut patch, b' ', line);
    }
    Some(patch)
}

fn start_of(line_count: usize) -> usize {
    usize::from(line_count > 0)
}

fn push_line(patch: &mut Vec<u8>, marker: u8, line: &[u8]) {
    patch.push(marker);
    patch.extend_from_slice(line);
    if !line.ends_with(b"\n") {
        patch.extend_from_slice(b"\n\\ No newline at end of file\n");
    }
}

/// Quoted the way Git writes a path with characters it will not print as they are.
fn quote_path(path: &str) -> String {
    let plain = path
        .bytes()
        .all(|byte| (0x20..0x7f).contains(&byte) && byte != b'"' && byte != b'\\');
    if plain {
        return path.to_owned();
    }
    let mut quoted = String::from("\"");
    for byte in path.bytes() {
        match byte {
            b'"' => quoted.push_str("\\\""),
            b'\\' => quoted.push_str("\\\\"),
            0x20..=0x7e => quoted.push(char::from(byte)),
            _ => quoted.push_str(&format!("\\{byte:03o}")),
        }
    }
    quoted.push('"');
    quoted
}
