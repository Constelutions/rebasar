use std::ffi::OsString;
use std::fs;
use std::path::Path;
use std::time::{Duration, Instant};

use rebasar_core::platform::{self, EditorDescriptor, Os};
use tempfile::TempDir;

#[cfg(windows)]
const SHIM_EXTENSION: &str = ".cmd";
#[cfg(not(windows))]
const SHIM_EXTENSION: &str = "";

/// A stand-in for an editor's command line tool that records the folder it was asked to open,
/// so the lookup and the launch are tested without starting a real editor.
fn install_editor(dir: &Path, command: &str) {
    let shim = dir.join(format!("{command}{SHIM_EXTENSION}"));

    #[cfg(windows)]
    fs::write(&shim, "@echo off\r\n(echo %~1)> \"%~dp0opened.txt\"\r\n").expect("write shim");

    #[cfg(not(windows))]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::write(&shim, "#!/bin/sh\necho \"$1\" > \"$(dirname \"$0\")/opened.txt\"\n").expect("write shim");
        fs::set_permissions(&shim, fs::Permissions::from_mode(0o755)).expect("make executable");
    }
}

fn search_path(dir: &Path) -> OsString {
    dir.as_os_str().to_owned()
}

fn wait_for_opened(dir: &Path) -> String {
    let opened = dir.join("opened.txt");
    let deadline = Instant::now() + Duration::from_secs(10);
    while Instant::now() < deadline {
        if let Ok(text) = fs::read_to_string(&opened) {
            if !text.trim().is_empty() {
                return text.trim().to_owned();
            }
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    panic!("the editor was never started");
}

fn labels_on(os: Os) -> Vec<&'static str> {
    platform::detect_editors(platform::EDITORS, os, &OsString::new())
        .into_iter()
        .map(|editor| editor.label)
        .collect()
}

#[test]
fn the_editors_of_windows_are_listed_alphabetically() {
    assert_eq!(
        labels_on(Os::Windows),
        ["Edit", "Nano", "Notepad", "Notepad++", "Vim", "VS Code", "Zed"]
    );
}

#[test]
fn the_editors_of_macos_and_linux_leave_out_the_windows_ones() {
    assert_eq!(labels_on(Os::MacOs), ["Nano", "Vim", "VS Code", "Zed"]);
    assert_eq!(labels_on(Os::Linux), ["Nano", "Vim", "VS Code", "Zed"]);
}

#[test]
fn only_vs_code_and_zed_open_a_folder() {
    let folder_editors: Vec<_> = platform::detect_editors(platform::EDITORS, Os::Windows, &OsString::new())
        .into_iter()
        .filter(|editor| editor.opens_folders)
        .map(|editor| editor.id)
        .collect();

    assert_eq!(folder_editors, ["vscode", "zed"]);
}

#[test]
fn an_editor_on_the_path_is_available() {
    let bin = TempDir::new().unwrap();
    install_editor(bin.path(), "code");

    let editors = platform::supported_editors(&search_path(bin.path()));

    let vscode = editors.iter().find(|editor| editor.id == "vscode").unwrap();
    assert!(vscode.available);
    assert_eq!(vscode.unavailable_reason, None);
}

#[test]
fn an_editor_missing_from_the_path_is_unavailable_and_says_why() {
    let bin = TempDir::new().unwrap();
    install_editor(bin.path(), "code");

    let editors = platform::supported_editors(&search_path(bin.path()));

    let zed = editors.iter().find(|editor| editor.id == "zed").unwrap();
    assert!(!zed.available);
    assert_eq!(
        zed.unavailable_reason.as_deref(),
        Some("The zed command was not found on the PATH.")
    );
}

#[test]
fn editors_the_os_does_not_support_are_left_out() {
    let descriptors = [
        EditorDescriptor { id: "everywhere", label: "Everywhere", command: "everywhere", terminal: false, folders: true, os: &[Os::Windows, Os::MacOs, Os::Linux] },
        EditorDescriptor { id: "windows-only", label: "Windows only", command: "winonly", terminal: false, folders: true, os: &[Os::Windows] },
    ];

    let on_linux: Vec<_> = platform::detect_editors(&descriptors, Os::Linux, &OsString::new())
        .into_iter()
        .map(|editor| editor.id)
        .collect();
    let on_windows: Vec<_> = platform::detect_editors(&descriptors, Os::Windows, &OsString::new())
        .into_iter()
        .map(|editor| editor.id)
        .collect();

    assert_eq!(on_linux, ["everywhere"]);
    assert_eq!(on_windows, ["everywhere", "windows-only"]);
}

#[test]
fn opening_a_folder_starts_the_editor_with_that_folder() {
    let bin = TempDir::new().unwrap();
    install_editor(bin.path(), "code");
    let folder = TempDir::new().unwrap();

    platform::open_in_editor("vscode", folder.path(), &search_path(bin.path())).expect("open");

    let opened = wait_for_opened(bin.path());
    assert_eq!(Path::new(&opened), folder.path());
}

#[test]
fn an_editor_that_is_not_on_the_path_is_not_started() {
    let bin = TempDir::new().unwrap();
    let folder = TempDir::new().unwrap();

    let error = platform::open_in_editor("zed", folder.path(), &search_path(bin.path()))
        .expect_err("zed is not installed");

    assert_eq!(error, "The zed command was not found on the PATH.");
}

#[test]
fn an_unknown_editor_is_refused() {
    let bin = TempDir::new().unwrap();
    let folder = TempDir::new().unwrap();

    let error = platform::open_in_editor("emacs", folder.path(), &search_path(bin.path()))
        .expect_err("emacs is not supported");

    assert_eq!(error, "emacs is not a supported editor.");
}

#[test]
fn something_that_is_not_a_folder_is_refused() {
    let bin = TempDir::new().unwrap();
    install_editor(bin.path(), "code");
    let folder = TempDir::new().unwrap();
    let missing = folder.path().join("missing");

    let error = platform::open_in_editor("vscode", &missing, &search_path(bin.path()))
        .expect_err("the folder does not exist");

    assert!(error.ends_with("is not a folder."), "{error}");
}

fn worktree_with(file: &str) -> TempDir {
    let worktree = TempDir::new().unwrap();
    let path = worktree.path().join(file);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, "content").unwrap();
    worktree
}

#[test]
fn opening_a_file_starts_the_editor_with_the_file_inside_the_worktree() {
    let bin = TempDir::new().unwrap();
    install_editor(bin.path(), "code");
    let worktree = worktree_with("src/main.rs");

    platform::open_file_in_editor("vscode", worktree.path(), "src/main.rs", &search_path(bin.path())).expect("open");

    let opened = wait_for_opened(bin.path());
    assert_eq!(
        platform::canonical(Path::new(&opened)).unwrap(),
        platform::canonical(&worktree.path().join("src").join("main.rs")).unwrap()
    );
}

#[test]
fn a_file_that_climbs_out_of_the_worktree_is_refused() {
    let bin = TempDir::new().unwrap();
    install_editor(bin.path(), "code");
    let outer = TempDir::new().unwrap();
    fs::write(outer.path().join("secret.txt"), "content").unwrap();
    let worktree = outer.path().join("worktree");
    fs::create_dir(&worktree).unwrap();

    let error = platform::open_file_in_editor("vscode", &worktree, "../secret.txt", &search_path(bin.path()))
        .expect_err("the file is outside the Worktree");

    assert_eq!(error, "../secret.txt is outside the Worktree.");
}

#[test]
fn an_absolute_path_outside_the_worktree_is_refused() {
    let bin = TempDir::new().unwrap();
    install_editor(bin.path(), "code");
    let outside = worktree_with("secret.txt");
    let worktree = TempDir::new().unwrap();
    let absolute = outside.path().join("secret.txt").to_string_lossy().into_owned();

    let error = platform::open_file_in_editor("vscode", worktree.path(), &absolute, &search_path(bin.path()))
        .expect_err("the file is outside the Worktree");

    assert_eq!(error, format!("{absolute} is outside the Worktree."));
}

#[test]
fn a_file_that_no_longer_exists_is_refused() {
    let bin = TempDir::new().unwrap();
    install_editor(bin.path(), "code");
    let worktree = TempDir::new().unwrap();

    let error = platform::open_file_in_editor("vscode", worktree.path(), "deleted.txt", &search_path(bin.path()))
        .expect_err("the file was deleted");

    assert_eq!(error, "deleted.txt does not exist.");
}

#[test]
fn a_folder_is_not_opened_as_a_file() {
    let bin = TempDir::new().unwrap();
    install_editor(bin.path(), "code");
    let worktree = worktree_with("src/main.rs");

    let error = platform::open_file_in_editor("vscode", worktree.path(), "src", &search_path(bin.path()))
        .expect_err("src is a folder");

    assert_eq!(error, "src is not a file.");
}

#[test]
fn a_terminal_editor_that_is_not_on_the_path_is_not_started() {
    let bin = TempDir::new().unwrap();
    let worktree = worktree_with("notes.txt");

    let error = platform::open_file_in_editor("vim", worktree.path(), "notes.txt", &search_path(bin.path()))
        .expect_err("vim is not installed");

    assert_eq!(error, "The vim command was not found on the PATH.");
}

#[test]
fn an_unknown_editor_is_refused_for_a_file_too() {
    let bin = TempDir::new().unwrap();
    let worktree = worktree_with("notes.txt");

    let error = platform::open_file_in_editor("emacs", worktree.path(), "notes.txt", &search_path(bin.path()))
        .expect_err("emacs is not supported");

    assert_eq!(error, "emacs is not a supported editor.");
}

#[test]
fn an_editor_that_cannot_open_a_folder_is_refused_for_one() {
    let bin = TempDir::new().unwrap();
    install_editor(bin.path(), "vim");
    let folder = TempDir::new().unwrap();

    let error = platform::open_in_editor("vim", folder.path(), &search_path(bin.path()))
        .expect_err("vim only opens files here");

    assert_eq!(error, "Vim cannot open a folder.");
}

fn shim_path(dir: &Path, command: &str) -> std::path::PathBuf {
    dir.join(format!("{command}{SHIM_EXTENSION}"))
}

fn args(launch: &platform::TerminalLaunch) -> Vec<String> {
    launch.args.iter().map(|arg| arg.to_string_lossy().into_owned()).collect()
}

#[test]
fn windows_runs_a_terminal_editor_in_windows_terminal_when_it_is_installed() {
    let bin = TempDir::new().unwrap();
    install_editor(bin.path(), "wt");

    let launch = platform::terminal_launch(Os::Windows, Path::new("vim.exe"), Path::new("notes.txt"), &search_path(bin.path()))
        .expect("launch");

    assert_eq!(launch.program, shim_path(bin.path(), "wt"));
    assert_eq!(args(&launch), ["vim.exe", "notes.txt"]);
}

#[test]
fn windows_falls_back_to_a_new_console_window_without_windows_terminal() {
    let bin = TempDir::new().unwrap();

    let launch = platform::terminal_launch(Os::Windows, Path::new("vim.exe"), Path::new("notes.txt"), &search_path(bin.path()))
        .expect("launch");

    assert_eq!(launch.program, Path::new("cmd"));
    assert_eq!(args(&launch), ["/c", "start", "", "vim.exe", "notes.txt"]);
}

#[test]
fn linux_prefers_the_terminal_the_distribution_points_at() {
    let bin = TempDir::new().unwrap();
    install_editor(bin.path(), "x-terminal-emulator");
    install_editor(bin.path(), "xterm");

    let launch = platform::terminal_launch(Os::Linux, Path::new("/usr/bin/nano"), Path::new("notes.txt"), &search_path(bin.path()))
        .expect("launch");

    assert_eq!(launch.program, shim_path(bin.path(), "x-terminal-emulator"));
    assert_eq!(args(&launch), ["-e", "/usr/bin/nano", "notes.txt"]);
}

#[test]
fn linux_separates_the_command_of_gnome_terminal_with_a_double_dash() {
    let bin = TempDir::new().unwrap();
    install_editor(bin.path(), "gnome-terminal");

    let launch = platform::terminal_launch(Os::Linux, Path::new("/usr/bin/nano"), Path::new("notes.txt"), &search_path(bin.path()))
        .expect("launch");

    assert_eq!(launch.program, shim_path(bin.path(), "gnome-terminal"));
    assert_eq!(args(&launch), ["--", "/usr/bin/nano", "notes.txt"]);
}

#[test]
fn linux_without_a_terminal_says_so() {
    let bin = TempDir::new().unwrap();

    let error = platform::terminal_launch(Os::Linux, Path::new("/usr/bin/nano"), Path::new("notes.txt"), &search_path(bin.path()))
        .expect_err("no terminal");

    assert_eq!(error, "No terminal emulator was found on the PATH.");
}

#[test]
fn macos_asks_terminal_to_run_the_quoted_command() {
    let launch = platform::terminal_launch(
        Os::MacOs,
        Path::new("/usr/bin/vim"),
        Path::new("/work/it's.txt"),
        &OsString::new(),
    )
    .expect("launch");

    assert_eq!(launch.program, Path::new("osascript"));
    assert_eq!(
        args(&launch),
        [
            "-e",
            r#"tell application "Terminal" to do script "'/usr/bin/vim' '/work/it'\\''s.txt'""#,
            "-e",
            r#"tell application "Terminal" to activate"#,
        ]
    );
}
