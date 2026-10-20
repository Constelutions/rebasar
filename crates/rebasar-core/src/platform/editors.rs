use std::ffi::OsStr;
use std::path::{Path, PathBuf};
use std::process::Stdio;

use serde::Serialize;

use super::process::hidden_command;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Os {
    Windows,
    MacOs,
    Linux,
}

impl Os {
    pub const fn current() -> Self {
        if cfg!(windows) {
            Self::Windows
        } else if cfg!(target_os = "macos") {
            Self::MacOs
        } else {
            Self::Linux
        }
    }
}

/// What the platform layer knows about an editor before looking at the machine. Supporting
/// another editor is adding an entry to `EDITORS`.
#[derive(Debug, Clone, Copy)]
pub struct EditorDescriptor {
    pub id: &'static str,
    pub label: &'static str,
    /// The command line tool that opens a path in the editor.
    pub command: &'static str,
    /// Runs inside a terminal rather than a window of its own.
    pub terminal: bool,
    pub os: &'static [Os],
}

const EVERY_OS: &[Os] = &[Os::Windows, Os::MacOs, Os::Linux];

pub const EDITORS: &[EditorDescriptor] = &[
    EditorDescriptor { id: "vscode", label: "VS Code", command: "code", terminal: false, os: EVERY_OS },
    EditorDescriptor { id: "zed", label: "Zed", command: "zed", terminal: false, os: EVERY_OS },
];

/// An editor the OS supports, and whether its command was found on the PATH.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Editor {
    pub id: &'static str,
    pub label: &'static str,
    pub available: bool,
    pub unavailable_reason: Option<String>,
}

/// The editors of this OS, alphabetically, each checked against `search_path` (the value of `PATH`).
pub fn supported_editors(search_path: &OsStr) -> Vec<Editor> {
    detect_editors(EDITORS, Os::current(), search_path)
}

pub fn detect_editors(descriptors: &[EditorDescriptor], os: Os, search_path: &OsStr) -> Vec<Editor> {
    let mut editors: Vec<Editor> = descriptors
        .iter()
        .filter(|descriptor| descriptor.os.contains(&os))
        .map(|descriptor| {
            let available = find_on_path(descriptor.command, search_path).is_some();
            Editor {
                id: descriptor.id,
                label: descriptor.label,
                available,
                unavailable_reason: (!available).then(|| not_found(descriptor)),
            }
        })
        .collect();
    editors.sort_by_key(|editor| editor.label.to_lowercase());
    editors
}

/// Starts the editor on a folder without waiting for it to close.
pub fn open_in_editor(editor_id: &str, folder: &Path, search_path: &OsStr) -> Result<(), String> {
    let descriptor = EDITORS
        .iter()
        .find(|descriptor| descriptor.id == editor_id && descriptor.os.contains(&Os::current()))
        .ok_or_else(|| format!("{editor_id} is not a supported editor."))?;
    if !folder.is_dir() {
        return Err(format!("{} is not a folder.", folder.display()));
    }
    let program = find_on_path(descriptor.command, search_path).ok_or_else(|| not_found(descriptor))?;

    hidden_command(&program)
        .arg(folder)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map(drop)
        .map_err(|error| format!("could not start {}: {error}", descriptor.label))
}

fn not_found(descriptor: &EditorDescriptor) -> String {
    format!("The {} command was not found on the PATH.", descriptor.command)
}

/// Only the extensions `Command` can start directly: the others in `PATHEXT` need a script host.
#[cfg(windows)]
const EXECUTABLE_EXTENSIONS: &[&str] = &["exe", "cmd", "bat", "com"];

fn find_on_path(command: &str, search_path: &OsStr) -> Option<PathBuf> {
    std::env::split_paths(search_path).find_map(|directory| {
        #[cfg(windows)]
        {
            EXECUTABLE_EXTENSIONS
                .iter()
                .map(|extension| directory.join(format!("{command}.{extension}")))
                .find(|candidate| candidate.is_file())
        }

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let candidate = directory.join(command);
            let executable = candidate
                .metadata()
                .is_ok_and(|metadata| metadata.is_file() && metadata.permissions().mode() & 0o111 != 0);
            executable.then_some(candidate)
        }
    })
}
