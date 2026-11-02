mod common;

use std::fs;
use std::path::Path;
use std::process::{Command, Output};

use common::{stderr, stdout, Install};
use rebasar_testkit::TempRepo;

fn repository() -> TempRepo {
    let repo = TempRepo::init("sample");
    repo.commit_file("README.md", "hello", "Initial commit");
    repo
}

/// The path the app was started with, compared after both sides are resolved the same way, since
/// Git reports a Windows path in a different spelling than the folder was created with.
fn assert_opened(install: &Install, expected: &Path) {
    let recorded = install.app_arguments().expect("the app was started");
    assert_eq!(
        fs::canonicalize(recorded.trim()).expect("the recorded path exists"),
        fs::canonicalize(expected).expect("the expected path exists"),
    );
}

fn assert_rejected(output: &Output, install: &Install, reason: &str) {
    assert_eq!(output.status.code(), Some(1), "stdout: {}", stdout(output));
    assert_eq!(stdout(output), "");
    assert_eq!(
        stderr(output).lines().count(),
        1,
        "stderr: {}",
        stderr(output)
    );
    assert!(
        stderr(output).contains(reason),
        "expected '{reason}' in: {}",
        stderr(output)
    );
    assert!(install.app_was_not_started());
}

#[test]
fn a_repository_root_opens_that_worktree() {
    let repo = repository();
    let install = Install::with_app();

    let output = install.run(&[repo.path().to_str().unwrap()]);

    assert!(output.status.success(), "stderr: {}", stderr(&output));
    assert_opened(&install, repo.path());
}

#[test]
fn a_subfolder_opens_the_worktree_that_contains_it() {
    let repo = repository();
    let subfolder = repo.path().join("src").join("deep");
    fs::create_dir_all(&subfolder).unwrap();
    let install = Install::with_app();

    let output = install.run(&[subfolder.to_str().unwrap()]);

    assert!(output.status.success(), "stderr: {}", stderr(&output));
    assert_opened(&install, repo.path());
}

#[test]
fn a_file_inside_a_worktree_opens_that_worktree() {
    let repo = repository();
    let install = Install::with_app();

    let output = install.run(&[repo.path().join("README.md").to_str().unwrap()]);

    assert!(output.status.success(), "stderr: {}", stderr(&output));
    assert_opened(&install, repo.path());
}

#[test]
fn a_linked_worktree_opens_itself_and_not_the_main_one() {
    let repo = repository();
    let linked = repo.add_worktree("sample-hotfix", "hotfix");
    let install = Install::with_app();

    let output = install.run(&[linked.to_str().unwrap()]);

    assert!(output.status.success(), "stderr: {}", stderr(&output));
    assert_opened(&install, &linked);
}

#[test]
fn relative_paths_resolve_against_the_current_folder() {
    let repo = repository();
    fs::create_dir_all(repo.path().join("src")).unwrap();

    for (relative, expected_root) in [
        (".", repo.path()),
        ("src", repo.path()),
        ("..", repo.path()),
    ] {
        let install = Install::with_app();
        let start = if relative == ".." {
            repo.path().join("src")
        } else {
            repo.path().to_path_buf()
        };

        let output = install.run_in(&start, &[relative]);

        assert!(
            output.status.success(),
            "'{relative}' stderr: {}",
            stderr(&output)
        );
        assert_opened(&install, expected_root);
    }
}

#[test]
fn a_path_that_does_not_exist_is_rejected() {
    let folder = tempfile::tempdir().unwrap();
    let install = Install::with_app();
    let missing = folder.path().join("nowhere");

    let output = install.run(&[missing.to_str().unwrap()]);

    assert_rejected(&output, &install, "does not exist");
}

#[test]
fn a_folder_outside_any_repository_is_rejected() {
    let folder = tempfile::tempdir().unwrap();
    let install = Install::with_app();

    let output = install.run(&[folder.path().to_str().unwrap()]);

    assert_rejected(&output, &install, "is not inside a Git worktree");
}

#[test]
fn the_git_folder_of_a_repository_is_not_a_worktree() {
    let repo = repository();
    let install = Install::with_app();

    let output = install.run(&[repo.path().join(".git").to_str().unwrap()]);

    assert_rejected(&output, &install, "is not inside a Git worktree");
}

#[test]
fn a_bare_repository_is_rejected_because_it_has_no_worktree() {
    let folder = tempfile::tempdir().unwrap();
    let bare = folder.path().join("bare.git");
    let status = Command::new("git")
        .args(["init", "--bare", "-q"])
        .arg(&bare)
        .status()
        .expect("run git");
    assert!(status.success());
    let install = Install::with_app();

    let output = install.run(&[bare.to_str().unwrap()]);

    assert_rejected(&output, &install, "bare repository");
}

#[test]
fn a_missing_git_is_reported_and_the_app_is_not_started() {
    let repo = repository();
    let install = Install::with_app();

    let output = install.run_without_git(&[repo.path().to_str().unwrap()]);

    assert_rejected(&output, &install, "git was not found");
}

#[test]
fn more_than_one_path_is_rejected() {
    let repo = repository();
    let install = Install::with_app();

    let output = install.run(&[repo.path().to_str().unwrap(), repo.path().to_str().unwrap()]);

    assert_rejected(&output, &install, "one path");
}

#[test]
fn a_valid_path_with_no_app_beside_the_cli_is_still_one_line_and_exit_code_1() {
    let repo = repository();
    let install = Install::without_app();

    let output = install.run(&[repo.path().to_str().unwrap()]);

    assert_eq!(output.status.code(), Some(1));
    assert!(stderr(&output).contains("Rebasar app"));
}

#[test]
fn a_worktree_whose_folder_name_is_not_ascii_still_opens() {
    let repo = TempRepo::init("répertoire-日本");
    repo.commit_file("README.md", "hello", "Initial commit");
    let install = Install::with_app();

    let output = install.run(&[repo.path().to_str().unwrap()]);

    assert!(output.status.success(), "stderr: {}", stderr(&output));
    assert_opened(&install, repo.path());
}
