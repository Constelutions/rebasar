use rebasar_core::{ChangeKind, Core, FileChange, WorktreeStatus};
use rebasar_testkit::TempRepo;

fn status_of(repo: &TempRepo) -> WorktreeStatus {
    Core::new(|_| {})
        .worktree_status(repo.path())
        .expect("worktree status")
}

fn change(path: &str, kind: ChangeKind, added: u32, removed: u32) -> FileChange {
    FileChange {
        path: path.to_owned(),
        original_path: None,
        kind,
        added: Some(added),
        removed: Some(removed),
    }
}

fn repo_with_initial_commit() -> TempRepo {
    let repo = TempRepo::init("sample");
    repo.commit_file("README.md", "one\ntwo\nthree\n", "Initial commit");
    repo
}

#[test]
fn a_clean_worktree_has_no_changes() {
    let repo = repo_with_initial_commit();

    assert_eq!(status_of(&repo), WorktreeStatus::default());
}

#[test]
fn an_untracked_file_is_unstaged_and_counts_all_its_lines_as_added() {
    let repo = repo_with_initial_commit();
    repo.write_file("notes.txt", "a\nb\n");

    let status = status_of(&repo);

    assert_eq!(
        status.unstaged,
        vec![change("notes.txt", ChangeKind::Untracked, 2, 0)]
    );
    assert!(status.staged.is_empty());
}

#[test]
fn a_modified_file_is_unstaged_with_its_added_and_removed_lines() {
    let repo = repo_with_initial_commit();
    repo.write_file("README.md", "one\nTWO\nthree\nfour\n");

    let status = status_of(&repo);

    assert_eq!(
        status.unstaged,
        vec![change("README.md", ChangeKind::Modified, 2, 1)]
    );
    assert!(status.staged.is_empty());
}

#[test]
fn a_staged_new_file_is_listed_as_staged_and_not_as_unstaged() {
    let repo = repo_with_initial_commit();
    repo.write_file("src/lib.rs", "fn a() {}\nfn b() {}\n")
        .stage("src/lib.rs");

    let status = status_of(&repo);

    assert_eq!(
        status.staged,
        vec![change("src/lib.rs", ChangeKind::Added, 2, 0)]
    );
    assert!(status.unstaged.is_empty());
}

#[test]
fn a_staged_modification_counts_against_the_committed_version() {
    let repo = repo_with_initial_commit();
    repo.write_file("README.md", "one\nthree\n")
        .stage("README.md");

    assert_eq!(
        status_of(&repo).staged,
        vec![change("README.md", ChangeKind::Modified, 0, 1)]
    );
}

#[test]
fn a_file_changed_after_staging_appears_in_both_lists() {
    let repo = repo_with_initial_commit();
    repo.write_file("README.md", "one\ntwo\nthree\nfour\n")
        .stage("README.md")
        .write_file("README.md", "one\ntwo\nthree\nfour\nfive\n");

    let status = status_of(&repo);

    assert_eq!(
        status.staged,
        vec![change("README.md", ChangeKind::Modified, 1, 0)]
    );
    assert_eq!(
        status.unstaged,
        vec![change("README.md", ChangeKind::Modified, 1, 0)]
    );
}

#[test]
fn a_file_deleted_from_disk_is_an_unstaged_deletion_counting_its_lines_as_removed() {
    let repo = repo_with_initial_commit();
    repo.delete_file("README.md");

    assert_eq!(
        status_of(&repo).unstaged,
        vec![change("README.md", ChangeKind::Deleted, 0, 3)]
    );
}

#[test]
fn a_staged_deletion_is_listed_as_staged() {
    let repo = repo_with_initial_commit();
    repo.git(&["rm", "--quiet", "README.md"]);

    let status = status_of(&repo);

    assert_eq!(
        status.staged,
        vec![change("README.md", ChangeKind::Deleted, 0, 3)]
    );
    assert!(status.unstaged.is_empty());
}

#[test]
fn a_staged_rename_remembers_the_original_path() {
    let repo = repo_with_initial_commit();
    repo.git(&["mv", "README.md", "GUIDE.md"]);

    assert_eq!(
        status_of(&repo).staged,
        vec![FileChange {
            original_path: Some("README.md".to_owned()),
            ..change("GUIDE.md", ChangeKind::Renamed, 0, 0)
        }]
    );
}

#[test]
fn a_file_moved_outside_git_shows_as_a_deletion_and_an_untracked_file() {
    let repo = repo_with_initial_commit();
    repo.git(&["mv", "README.md", "GUIDE.md"]);
    repo.git(&["reset", "--quiet"]);

    let status = status_of(&repo);

    assert_eq!(
        status.unstaged,
        vec![
            change("GUIDE.md", ChangeKind::Untracked, 3, 0),
            change("README.md", ChangeKind::Deleted, 0, 3),
        ]
    );
}

#[test]
fn ignored_files_are_not_listed_but_other_untracked_files_still_are() {
    let repo = repo_with_initial_commit();
    repo.commit_file(".gitignore", "*.log\nbuild/\n", "Ignore build output")
        .write_file("debug.log", "noise\n")
        .write_file("build/out.txt", "noise\n")
        .write_file("notes.txt", "keep\n");

    assert_eq!(
        status_of(&repo).unstaged,
        vec![change("notes.txt", ChangeKind::Untracked, 1, 0)]
    );
}

#[test]
fn a_tracked_file_that_is_later_ignored_still_reports_its_changes() {
    let repo = repo_with_initial_commit();
    repo.commit_file(".gitignore", "README.md\n", "Ignore the readme")
        .write_file("README.md", "changed\n");

    assert_eq!(
        status_of(&repo).unstaged,
        vec![change("README.md", ChangeKind::Modified, 1, 3)]
    );
}

#[test]
fn untracked_files_are_listed_individually_inside_new_folders() {
    let repo = repo_with_initial_commit();
    repo.write_file("docs/a.md", "a\n")
        .write_file("docs/deep/b.md", "b\n");

    assert_eq!(
        status_of(&repo).unstaged,
        vec![
            change("docs/a.md", ChangeKind::Untracked, 1, 0),
            change("docs/deep/b.md", ChangeKind::Untracked, 1, 0),
        ]
    );
}

#[test]
fn binary_files_are_listed_without_line_counts() {
    let repo = repo_with_initial_commit();
    repo.write_file("logo.png", [0x89, b'P', b'N', b'G', 0, 1, 2, 3]);

    assert_eq!(
        status_of(&repo).unstaged,
        vec![FileChange {
            path: "logo.png".to_owned(),
            original_path: None,
            kind: ChangeKind::Untracked,
            added: None,
            removed: None,
        }]
    );
}

#[test]
fn a_file_with_only_crlf_line_endings_changed_counts_just_the_edited_lines() {
    let repo = repo_with_initial_commit();
    repo.write_file("README.md", "one\r\nTWO\r\nthree\r\n");

    assert_eq!(
        status_of(&repo).unstaged,
        vec![change("README.md", ChangeKind::Modified, 1, 1)]
    );
}

#[test]
fn a_repository_without_commits_lists_staged_files_as_added() {
    let repo = TempRepo::init("fresh");
    repo.write_file("a.txt", "a\n").stage("a.txt");

    assert_eq!(
        status_of(&repo).staged,
        vec![change("a.txt", ChangeKind::Added, 1, 0)]
    );
}

#[test]
fn a_paused_merge_lists_the_conflicted_files_as_conflicts_only() {
    let repo = repo_with_initial_commit();
    repo.git(&["checkout", "--quiet", "-b", "topic"]);
    repo.commit_file("README.md", "one\ntopic\nthree\n", "Topic edit");
    repo.git(&["checkout", "--quiet", "main"]);
    repo.commit_file("README.md", "one\nmain\nthree\n", "Main edit");
    repo.commit_file("other.txt", "x\n", "Unrelated");
    repo.git_fails(&["merge", "topic"]);

    let status = status_of(&repo);

    assert_eq!(
        status.conflicts,
        vec![FileChange {
            path: "README.md".to_owned(),
            original_path: None,
            kind: ChangeKind::Conflicted,
            added: None,
            removed: None,
        }]
    );
    assert!(status.staged.is_empty(), "{:?}", status.staged);
    assert!(status.unstaged.is_empty(), "{:?}", status.unstaged);
}

#[test]
fn a_linked_worktree_reports_its_own_changes_only() {
    let repo = repo_with_initial_commit();
    let linked = repo.add_worktree("sample-hotfix", "hotfix");
    std::fs::write(linked.join("hotfix.txt"), "fix\n").expect("write file");
    repo.write_file("main-only.txt", "m\n");

    let status = Core::new(|_| {})
        .worktree_status(&linked)
        .expect("linked worktree status");

    assert_eq!(
        status.unstaged,
        vec![change("hotfix.txt", ChangeKind::Untracked, 1, 0)]
    );
}

#[test]
fn a_status_request_for_a_plain_folder_reports_it() {
    let folder = tempfile::tempdir().expect("temp dir");

    let error = Core::new(|_| {})
        .worktree_status(folder.path())
        .expect_err("not a repository");

    assert!(matches!(
        error,
        rebasar_core::ApiError::NotARepository { .. }
    ));
}

fn numbered(prefix: &str, index: usize) -> String {
    format!("{prefix}{index:03}.txt")
}

#[test]
fn a_large_changeset_reports_exact_line_counts_for_every_file_in_path_order() {
    const MODIFIED: usize = 200;
    const DELETED: usize = 50;
    const STAGED: usize = 50;
    const UNTRACKED: usize = 50;

    let repo = TempRepo::init("changeset");
    for index in 0..MODIFIED + DELETED + STAGED {
        repo.write_file(&numbered("f", index), "a\nb\nc\n");
    }
    repo.git(&["add", "--all"]);
    repo.git(&["commit", "--message", "Initial commit"]);

    let mut expected_unstaged = Vec::new();
    for index in 0..MODIFIED {
        let appended = index % 4;
        repo.write_file(
            &numbered("f", index),
            format!("a\nB\nc\n{}", "x\n".repeat(appended)),
        );
        expected_unstaged.push(change(
            &numbered("f", index),
            ChangeKind::Modified,
            1 + appended as u32,
            1,
        ));
    }
    for index in MODIFIED..MODIFIED + DELETED {
        repo.delete_file(&numbered("f", index));
        expected_unstaged.push(change(&numbered("f", index), ChangeKind::Deleted, 0, 3));
    }
    for index in 0..UNTRACKED {
        let lines = 1 + index % 3;
        repo.write_file(&numbered("u", index), "n\n".repeat(lines));
        expected_unstaged.push(change(
            &numbered("u", index),
            ChangeKind::Untracked,
            lines as u32,
            0,
        ));
    }

    let mut expected_staged = Vec::new();
    for index in MODIFIED + DELETED..MODIFIED + DELETED + STAGED {
        let appended = 1 + index % 4;
        repo.write_file(
            &numbered("f", index),
            format!("a\nb\nc\n{}", "y\n".repeat(appended)),
        );
        repo.stage(&numbered("f", index));
        expected_staged.push(change(
            &numbered("f", index),
            ChangeKind::Modified,
            appended as u32,
            0,
        ));
    }
    expected_unstaged.sort_by(|a, b| a.path.cmp(&b.path));
    expected_staged.sort_by(|a, b| a.path.cmp(&b.path));

    let status = status_of(&repo);

    assert_eq!(status.unstaged, expected_unstaged);
    assert_eq!(status.staged, expected_staged);
}
