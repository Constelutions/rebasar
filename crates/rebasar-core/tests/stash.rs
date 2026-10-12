use rebasar_core::{
    Assessment, ChangeKind, CommitDiffRequest, Core, DiffContent, MutationKind, MutationOutcome,
    StashInfo,
};
use rebasar_testkit::TempRepo;

fn core() -> Core {
    Core::new(|_| {})
}

fn ok(outcome: Result<MutationOutcome, rebasar_core::ApiError>) {
    assert_eq!(outcome.expect("runs"), MutationOutcome::Succeeded);
}

fn stashes(repo: &TempRepo) -> Vec<StashInfo> {
    core().list_stashes(repo.path()).expect("stashes")
}

fn lf(text: &str) -> String {
    text.replace("\r\n", "\n")
}

fn repo_with_commit() -> TempRepo {
    let repo = TempRepo::init("sample");
    repo.commit_file("a.txt", "one\n", "Initial commit");
    repo.commit_file("b.txt", "bee\n", "Add b");
    repo
}

#[test]
fn a_repository_without_stashes_lists_none() {
    let repo = repo_with_commit();

    assert!(stashes(&repo).is_empty());
}

#[test]
fn stashes_are_listed_newest_first_with_message_branch_and_age() {
    let repo = repo_with_commit();
    repo.write_file("a.txt", "first\n");
    ok(core().stash_changes(repo.path(), Some("Park the first"), false));
    repo.write_file("a.txt", "second\n");
    ok(core().stash_changes(repo.path(), None, false));

    let list = stashes(&repo);

    assert_eq!(list.len(), 2);
    assert!(list[0].message.starts_with("WIP on main: "), "{}", list[0].message);
    assert_eq!(list[0].branch, "main");
    assert_eq!(list[1].message, "On main: Park the first");
    assert_eq!(list[1].branch, "main");
    assert_eq!(list[0].id.len(), 40);
    assert!(list[0].timestamp >= list[1].timestamp && list[0].timestamp > 1_600_000_000);
}

#[test]
fn stashing_parks_the_changes_and_cleans_the_worktree() {
    let repo = repo_with_commit();
    repo.write_file("a.txt", "changed\n");

    ok(core().stash_changes(repo.path(), Some("Work"), false));

    assert_eq!(lf(&std::fs::read_to_string(repo.path().join("a.txt")).unwrap()), "one\n");
    assert_eq!(stashes(&repo).len(), 1);
}

#[test]
fn untracked_files_are_stashed_only_when_asked() {
    let repo = repo_with_commit();
    repo.write_file("new.txt", "untracked\n");
    repo.write_file("a.txt", "changed\n");

    ok(core().stash_changes(repo.path(), None, false));
    assert!(repo.path().join("new.txt").exists(), "left behind");
    ok(core().stash_changes(repo.path(), Some("With untracked"), true));
    assert!(!repo.path().join("new.txt").exists());
    assert_eq!(stashes(&repo).len(), 2);
}

#[test]
fn including_untracked_files_takes_them_along_and_the_preview_lists_them() {
    let repo = repo_with_commit();
    repo.write_file("new.txt", "untracked\n");
    repo.write_file("a.txt", "changed\n");

    ok(core().stash_changes(repo.path(), Some("All of it"), true));

    assert!(!repo.path().join("new.txt").exists());
    let preview = core().stash_preview(repo.path(), &stashes(&repo)[0].id).unwrap();
    assert_eq!(preview.files.iter().map(|f| f.path.as_str()).collect::<Vec<_>>(), ["a.txt"]);
    assert_eq!(preview.untracked, ["new.txt"]);
}

#[test]
fn stashing_with_nothing_to_stash_changes_nothing() {
    let repo = repo_with_commit();

    ok(core().stash_changes(repo.path(), None, false));

    assert!(stashes(&repo).is_empty());
}

#[test]
fn the_preview_lists_the_files_with_line_counts_and_their_diffs_read_like_a_commits() {
    let repo = repo_with_commit();
    repo.write_file("a.txt", "one\nmore\n");
    repo.write_file("b.txt", "changed\n");
    ok(core().stash_changes(repo.path(), None, false));
    let stash = stashes(&repo)[0].id.clone();

    let preview = core().stash_preview(repo.path(), &stash).unwrap();

    let files: Vec<_> = preview
        .files
        .iter()
        .map(|file| (file.path.as_str(), file.kind, file.added, file.removed))
        .collect();
    assert_eq!(
        files,
        [
            ("a.txt", ChangeKind::Modified, Some(1), Some(0)),
            ("b.txt", ChangeKind::Modified, Some(1), Some(1)),
        ]
    );
    let diff = core()
        .commit_file_diff(
            repo.path(),
            &CommitDiffRequest {
                commit: stash,
                parent: 0,
                path: "a.txt".to_owned(),
                original_path: None,
                load_large: false,
            },
        )
        .unwrap();
    let DiffContent::Text { hunks } = diff.content else {
        panic!("a text diff");
    };
    assert!(hunks[0].lines.iter().any(|line| line.text == "more"));
}

#[test]
fn applying_restores_the_changes_and_keeps_the_stash() {
    let repo = repo_with_commit();
    repo.write_file("a.txt", "changed\n");
    ok(core().stash_changes(repo.path(), None, false));
    let stash = stashes(&repo)[0].id.clone();

    ok(core().apply_stash(repo.path(), &stash));

    assert_eq!(lf(&std::fs::read_to_string(repo.path().join("a.txt")).unwrap()), "changed\n");
    assert_eq!(stashes(&repo).len(), 1);
}

#[test]
fn popping_restores_the_changes_and_removes_the_stash() {
    let repo = repo_with_commit();
    repo.write_file("a.txt", "changed\n");
    ok(core().stash_changes(repo.path(), None, false));
    let stash = stashes(&repo)[0].id.clone();

    ok(core().pop_stash(repo.path(), &stash));

    assert_eq!(lf(&std::fs::read_to_string(repo.path().join("a.txt")).unwrap()), "changed\n");
    assert!(stashes(&repo).is_empty());
}

#[test]
fn an_action_names_the_stash_by_id_so_a_newer_stash_never_takes_its_place() {
    let repo = repo_with_commit();
    repo.write_file("a.txt", "older\n");
    ok(core().stash_changes(repo.path(), Some("older"), false));
    let older = stashes(&repo)[0].id.clone();
    repo.write_file("a.txt", "newer\n");
    ok(core().stash_changes(repo.path(), Some("newer"), false));

    ok(core().pop_stash(repo.path(), &older));

    assert_eq!(lf(&std::fs::read_to_string(repo.path().join("a.txt")).unwrap()), "older\n");
    assert_eq!(stashes(&repo)[0].message, "On main: newer");
}

#[test]
fn a_stash_that_is_gone_is_an_error() {
    let repo = repo_with_commit();

    assert!(core().pop_stash(repo.path(), &"a".repeat(40)).is_err());
    assert!(core().stash_preview(repo.path(), &"a".repeat(40)).is_err());
}

#[test]
fn applying_a_stash_that_conflicts_leaves_conflicted_files_and_keeps_the_stash() {
    let repo = repo_with_commit();
    repo.write_file("a.txt", "stashed\n");
    ok(core().stash_changes(repo.path(), None, false));
    repo.commit_file("a.txt", "committed meanwhile\n", "Edit a");
    let stash = stashes(&repo)[0].id.clone();

    let outcome = core().pop_stash(repo.path(), &stash).unwrap();

    assert!(matches!(outcome, MutationOutcome::Failed { .. }));
    assert_eq!(stashes(&repo).len(), 1, "a conflicting pop keeps the stash");
    assert!(repo.git(&["ls-files", "--unmerged"]).contains("a.txt"));
}

#[test]
fn dropping_names_the_work_that_would_be_lost_and_then_removes_the_stash() {
    let repo = repo_with_commit();
    repo.write_file("a.txt", "one\ntwo\n");
    ok(core().stash_changes(repo.path(), None, false));
    let stash = stashes(&repo)[0].id.clone();

    let Assessment::Destructive { loss } = core()
        .assess_mutation(repo.path(), &MutationKind::DropStash { stash: stash.clone() })
        .unwrap()
    else {
        panic!("a stash holds work");
    };
    assert_eq!(loss.files.iter().map(|f| f.path.as_str()).collect::<Vec<_>>(), ["a.txt"]);

    ok(core().drop_stash(repo.path(), &stash));
    assert!(stashes(&repo).is_empty());
}
