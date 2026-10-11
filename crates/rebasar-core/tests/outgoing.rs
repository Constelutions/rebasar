use rebasar_core::{ApiError, Core, OutgoingCommit};
use rebasar_testkit::TempRepo;

fn subjects(commits: &[OutgoingCommit]) -> Vec<&str> {
    commits
        .iter()
        .map(|commit| commit.subject.as_str())
        .collect()
}

fn repo_with_pushed_branch() -> TempRepo {
    let repo = TempRepo::init("sample");
    repo.add_bare_remote("origin");
    repo.commit_file("README.md", "one\n", "Initial commit");
    repo.git(&["push", "--set-upstream", "origin", "main"]);
    repo
}

#[test]
fn commits_made_after_the_last_push_are_outgoing_newest_first() {
    let repo = repo_with_pushed_branch();
    repo.commit_file("a.txt", "a\n", "Add a");
    repo.commit_file("b.txt", "b\n", "Add b\n\nWith a body.");
    let core = Core::new(|_| {});

    let outgoing = core.outgoing_commits(repo.path()).expect("outgoing");

    assert_eq!(subjects(&outgoing), ["Add b", "Add a"]);
    assert_eq!(outgoing[0].id, repo.head_commit());
    assert_eq!(outgoing[0].short_id, &repo.head_commit()[..7]);
}

#[test]
fn a_commit_pushed_to_another_branch_is_still_outgoing_for_the_branch_with_an_upstream() {
    let repo = repo_with_pushed_branch();
    repo.commit_file("a.txt", "a\n", "Add a");
    repo.git(&["push", "origin", "main:other"]);
    let core = Core::new(|_| {});

    let outgoing = core.outgoing_commits(repo.path()).expect("outgoing");

    assert_eq!(subjects(&outgoing), ["Add a"]);
}

#[test]
fn nothing_is_outgoing_when_the_branch_is_pushed() {
    let repo = repo_with_pushed_branch();
    let core = Core::new(|_| {});

    assert!(core
        .outgoing_commits(repo.path())
        .expect("outgoing")
        .is_empty());
}

#[test]
fn an_amended_commit_is_outgoing_again() {
    let repo = repo_with_pushed_branch();
    repo.git(&["commit", "--amend", "--message", "Reworded"]);
    let core = Core::new(|_| {});

    let outgoing = core.outgoing_commits(repo.path()).expect("outgoing");

    assert_eq!(subjects(&outgoing), ["Reworded"]);
}

#[test]
fn without_an_upstream_the_commits_that_no_remote_has_are_outgoing() {
    let repo = repo_with_pushed_branch();
    repo.git(&["switch", "--create", "feature"]);
    repo.commit_file("a.txt", "a\n", "Add a");
    let core = Core::new(|_| {});

    let outgoing = core.outgoing_commits(repo.path()).expect("outgoing");

    assert_eq!(subjects(&outgoing), ["Add a"]);
}

#[test]
fn without_any_remote_every_commit_is_outgoing() {
    let repo = TempRepo::init("local");
    repo.commit_file("a.txt", "a\n", "Add a");
    repo.commit_file("b.txt", "b\n", "Add b");
    let core = Core::new(|_| {});

    let outgoing = core.outgoing_commits(repo.path()).expect("outgoing");

    assert_eq!(subjects(&outgoing), ["Add b", "Add a"]);
}

#[test]
fn a_repository_without_commits_has_nothing_outgoing() {
    let repo = TempRepo::init("fresh");
    let core = Core::new(|_| {});

    assert!(core
        .outgoing_commits(repo.path())
        .expect("outgoing")
        .is_empty());
}

#[test]
fn a_detached_head_lists_the_commits_no_remote_has() {
    let repo = repo_with_pushed_branch();
    repo.detach_head();
    repo.commit_file("a.txt", "a\n", "Add a");
    let core = Core::new(|_| {});

    let outgoing = core.outgoing_commits(repo.path()).expect("outgoing");

    assert_eq!(subjects(&outgoing), ["Add a"]);
}

#[test]
fn a_folder_that_is_not_a_repository_is_an_error() {
    let folder = tempfile::tempdir().expect("temp dir");
    let core = Core::new(|_| {});

    assert!(matches!(
        core.outgoing_commits(folder.path()),
        Err(ApiError::NotARepository { .. })
    ));
}
