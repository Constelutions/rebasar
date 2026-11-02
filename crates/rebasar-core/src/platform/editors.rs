use std::ffi::{OsStr, OsString};
use std::io;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use serde::Serialize;

use super::paths::canonical;
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
    /// Can be started on a folder, so it is offered for a whole Worktree.
    pub folders: bool,
    pub os: &'static [Os],
}

const EVERY_OS: &[Os] = &[Os::Windows, Os::MacOs, Os::Linux];
const WINDOWS: &[Os] = &[Os::Windows];

pub const EDITORS: &[EditorDescriptor] = &[
    EditorDescriptor { id: "vscode", label: "VS Code", command: "code", terminal: false, folders: true, os: EVERY_OS },
    EditorDescriptor { id: "zed", label: "Zed", command: "zed", terminal: false, folders: true, os: EVERY_OS },
    EditorDescriptor { id: "notepad", label: "Notepad", command: "notepad", terminal: false, folders: false, os: WINDOWS },
    EditorDescriptor { id: "notepad++", label: "Notepad++", command: "notepad++", terminal: false, folders: false, os: WINDOWS },
    EditorDescriptor { id: "edit", label: "Edit", command: "edit", terminal: true, folders: false, os: WINDOWS },
    EditorDescriptor { id: "nano", label: "Nano", command: "nano", terminal: true, folders: false, os: EVERY_OS },
    EditorDescriptor { id: "vim", label: "Vim", command: "vim", terminal: true, folders: false, os: EVERY_OS },
];

/// An editor the OS supports, and whether its command was found on the PATH.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Editor {
    pub id: &'static str,
    pub label: &'static str,
    pub opens_folders: bool,
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
                opens_folders: descriptor.folders,
                available,
                unavailable_reason: (!available).then(|| not_found(descriptor)),
            }
        })
        .collect();
    editors.sort_by_key(|editor| editor.label.to_lowercase());
    editors
}

fn supported_descriptor(editor_id: &str) -> Result<&'static EditorDescriptor, String> {
    EDITORS
        .iter()
        .find(|descriptor| descriptor.id == editor_id && descriptor.os.contains(&Os::current()))
        .ok_or_else(|| format!("{editor_id} is not a supported editor."))
}

/// Starts the editor on a folder without waiting for it to close.
pub fn open_in_editor(editor_id: &str, folder: &Path, search_path: &OsStr) -> Result<(), String> {
    let descriptor = supported_descriptor(editor_id)?;
    if !descriptor.folders {
        return Err(format!("{} cannot open a folder.", descriptor.label));
    }
    if !folder.is_dir() {
        return Err(format!("{} is not a folder.", folder.display()));
    }
    let program = find_on_path(descriptor.command, search_path).ok_or_else(|| not_found(descriptor))?;

    let mut command = hidden_command(&program);
    command.arg(folder);
    spawn_detached(command, descriptor)
}

/// Starts the editor on `file`, a path relative to `worktree`, without waiting for it to close.
/// A terminal editor gets a terminal window of its own.
pub fn open_file_in_editor(editor_id: &str, worktree: &Path, file: &str, search_path: &OsStr) -> Result<(), String> {
    let descriptor = supported_descriptor(editor_id)?;
    let path = resolve_in_worktree(worktree, file)?;
    let program = find_on_path(descriptor.command, search_path).ok_or_else(|| not_found(descriptor))?;

    let command = if descriptor.terminal {
        let launch = terminal_launch(Os::current(), &program, &path, search_path)?;
        let mut command = hidden_command(&launch.program);
        command.args(&launch.args);
        command
    } else {
        let mut command = hidden_command(&program);
        command.arg(&path);
        command
    };
    spawn_detached(command, descriptor)
}

fn spawn_detached(mut command: Command, descriptor: &EditorDescriptor) -> Result<(), String> {
    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map(drop)
        .map_err(|error| format!("could not start {}: {error}", descriptor.label))
}

/// Follows symlinks and `..`, so a path that leads out of the Worktree is caught wherever it hides.
fn resolve_in_worktree(worktree: &Path, file: &str) -> Result<PathBuf, String> {
    let root = canonical(worktree).map_err(|error| format!("could not read {}: {error}", worktree.display()))?;
    let path = canonical(&root.join(file)).map_err(|error| match error.kind() {
        io::ErrorKind::NotFound => format!("{file} does not exist."),
        _ => format!("could not read {file}: {error}"),
    })?;
    if !path.starts_with(&root) {
        return Err(format!("{file} is outside the Worktree."));
    }
    if !path.is_file() {
        return Err(format!("{file} is not a file."));
    }
    Ok(path)
}

/// A program and its arguments, built apart from starting it so that it can be checked without
/// opening a window.
#[derive(Debug, PartialEq, Eq)]
pub struct TerminalLaunch {
    pub program: PathBuf,
    pub args: Vec<OsString>,
}

/// How to run `editor file` in a terminal window of its own on `os`.
pub fn terminal_launch(os: Os, editor: &Path, file: &Path, search_path: &OsStr) -> Result<TerminalLaunch, String> {
    match os {
        Os::Windows => Ok(match find_on_path("wt", search_path) {
            Some(windows_terminal) => TerminalLaunch {
                program: windows_terminal,
                args: vec![editor.into(), file.into()],
            },
            None => TerminalLaunch {
                program: PathBuf::from("cmd"),
                args: vec!["/c".into(), "start".into(), "".into(), editor.into(), file.into()],
            },
        }),
        Os::MacOs => {
            let command = format!("{} {}", shell_quote(editor), shell_quote(file));
            let script = command.replace('\\', "\\\\").replace('"', "\\\"");
            Ok(TerminalLaunch {
                program: PathBuf::from("osascript"),
                args: vec![
                    "-e".into(),
                    format!("tell application \"Terminal\" to do script \"{script}\"").into(),
                    "-e".into(),
                    "tell application \"Terminal\" to activate".into(),
                ],
            })
        }
        Os::Linux => LINUX_TERMINALS
            .iter()
            .find_map(|(command, run_flag)| {
                find_on_path(command, search_path).map(|terminal| TerminalLaunch {
                    program: terminal,
                    args: vec![(*run_flag).into(), editor.into(), file.into()],
                })
            })
            .ok_or_else(|| "No terminal emulator was found on the PATH.".to_owned()),
    }
}

/// The terminals tried in order, each with the flag that makes it run the rest of its arguments.
const LINUX_TERMINALS: &[(&str, &str)] = &[
    ("x-terminal-emulator", "-e"),
    ("gnome-terminal", "--"),
    ("konsole", "-e"),
    ("xterm", "-e"),
];

fn shell_quote(path: &Path) -> String {
    format!("'{}'", path.to_string_lossy().replace('\'', "'\\''"))
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
