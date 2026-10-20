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

#[test]
fn the_supported_editors_are_listed_alphabetically() {
    let bin = TempDir::new().unwrap();

    let labels: Vec<_> = platform::supported_editors(&search_path(bin.path()))
        .into_iter()
        .map(|editor| editor.label)
        .collect();

    assert_eq!(labels, ["VS Code", "Zed"]);
}

#[test]
fn an_editor_on_the_path_is_available() {
    let bin = TempDir::new().unwrap();
    install_editor(bin.path(), "code");

    let editors = platform::supported_editors(&search_path(bin.path()));

    assert!(editors[0].available);
    assert_eq!(editors[0].unavailable_reason, None);
}

#[test]
fn an_editor_missing_from_the_path_is_unavailable_and_says_why() {
    let bin = TempDir::new().unwrap();
    install_editor(bin.path(), "code");

    let editors = platform::supported_editors(&search_path(bin.path()));

    assert_eq!(editors[1].id, "zed");
    assert!(!editors[1].available);
    assert_eq!(
        editors[1].unavailable_reason.as_deref(),
        Some("The zed command was not found on the PATH.")
    );
}

#[test]
fn editors_the_os_does_not_support_are_left_out() {
    let descriptors = [
        EditorDescriptor { id: "everywhere", label: "Everywhere", command: "everywhere", terminal: false, os: &[Os::Windows, Os::MacOs, Os::Linux] },
        EditorDescriptor { id: "windows-only", label: "Windows only", command: "winonly", terminal: false, os: &[Os::Windows] },
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
