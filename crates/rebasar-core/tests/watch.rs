use std::path::Path;
use std::sync::mpsc::{self, Receiver};
use std::time::Duration;

use rebasar_core::{ChangeKind, Core, CoreEvent};
use rebasar_testkit::TempRepo;

const PATIENCE: Duration = Duration::from_secs(10);
const QUIET: Duration = Duration::from_millis(800);

fn core_with_events() -> (Core, Receiver<CoreEvent>) {
    let (sender, receiver) = mpsc::channel();
    let core = Core::new(move |event| {
        let _ = sender.send(event);
    });
    (core, receiver)
}

fn canonical(path: &Path) -> String {
    dunce::canonicalize(path)
        .expect("canonicalize")
        .to_string_lossy()
        .into_owned()
}

fn expect_change(events: &Receiver<CoreEvent>, worktree: &Path) {
    let event = events
        .recv_timeout(PATIENCE)
        .expect("the Worktree should have reported a change");
    assert_eq!(
        event,
        CoreEvent::WorktreeChanged {
            worktree_path: canonical(worktree)
        }
    );
}

fn settle(events: &Receiver<CoreEvent>) {
    while events.recv_timeout(QUIET).is_ok() {}
}

fn watched_repo() -> (Core, Receiver<CoreEvent>, TempRepo) {
    let repo = TempRepo::init("sample");
    repo.commit_file("README.md", "one\n", "Initial commit");
    let (core, events) = core_with_events();
    core.watch_worktree(repo.path()).expect("watch worktree");
    (core, events, repo)
}

#[test]
fn a_file_created_outside_the_app_is_reported_and_then_visible_in_the_status() {
    let (core, events, repo) = watched_repo();

    repo.write_file("from-terminal.txt", "hello\n");

    expect_change(&events, repo.path());
    let status = core.worktree_status(repo.path()).expect("status");
    assert_eq!(status.unstaged.len(), 1);
    assert_eq!(status.unstaged[0].path, "from-terminal.txt");
    assert_eq!(status.unstaged[0].kind, ChangeKind::Untracked);
}

#[test]
fn a_file_changed_in_a_subfolder_is_reported() {
    let (_core, events, repo) = watched_repo();
    repo.write_file("src/deep/lib.rs", "fn main() {}\n");
    expect_change(&events, repo.path());
    settle(&events);

    repo.write_file("src/deep/lib.rs", "fn main() { run(); }\n");

    expect_change(&events, repo.path());
}

#[test]
fn staging_from_the_terminal_is_reported() {
    let (_core, events, repo) = watched_repo();
    repo.write_file("new.txt", "x\n");
    expect_change(&events, repo.path());
    settle(&events);

    repo.git(&["add", "new.txt"]);

    expect_change(&events, repo.path());
}

#[test]
fn committing_from_the_terminal_is_reported() {
    let (_core, events, repo) = watched_repo();
    repo.write_file("new.txt", "x\n").stage("new.txt");
    settle(&events);

    repo.git(&["commit", "--quiet", "--message", "Add new.txt"]);

    expect_change(&events, repo.path());
}

#[test]
fn staging_in_a_linked_worktree_is_reported_even_though_its_git_folder_lives_elsewhere() {
    let repo = TempRepo::init("sample");
    repo.commit_file("README.md", "one\n", "Initial commit");
    let linked = repo.add_worktree("sample-hotfix", "hotfix");
    let (core, events) = core_with_events();
    core.watch_worktree(&linked).expect("watch linked worktree");
    std::fs::write(linked.join("fix.txt"), "fix\n").expect("write file");
    expect_change(&events, &linked);
    settle(&events);

    let staged = std::process::Command::new("git")
        .args(["add", "fix.txt"])
        .current_dir(&linked)
        .status()
        .expect("run git add");

    assert!(staged.success());
    expect_change(&events, &linked);
}

#[test]
fn a_burst_of_changes_is_reported_as_a_handful_of_events_not_one_per_file() {
    let (_core, events, repo) = watched_repo();

    for index in 0..60 {
        repo.write_file(&format!("burst/{index}.txt"), "x\n");
    }
    expect_change(&events, repo.path());
    let mut extra = 0;
    while events.recv_timeout(QUIET).is_ok() {
        extra += 1;
    }

    assert!(extra < 5, "{extra} further events for one burst");
}

#[test]
fn nothing_is_reported_while_the_worktree_is_quiet() {
    let (_core, events, _repo) = watched_repo();

    assert!(events.recv_timeout(QUIET).is_err());
}

#[test]
fn git_internals_that_do_not_affect_the_status_are_not_reported() {
    let (_core, events, repo) = watched_repo();

    repo.git(&["repack", "--quiet", "-a", "-d"]);

    assert!(events.recv_timeout(QUIET).is_err());
}

#[test]
fn watching_the_same_worktree_twice_does_not_duplicate_events() {
    let (core, events, repo) = watched_repo();
    core.watch_worktree(repo.path()).expect("watch again");

    repo.write_file("once.txt", "x\n");
    expect_change(&events, repo.path());

    let mut extra = 0;
    while events.recv_timeout(QUIET).is_ok() {
        extra += 1;
    }
    assert!(extra < 2, "{extra} further events for one change");
}

#[test]
fn an_unwatched_worktree_stops_reporting() {
    let (core, events, repo) = watched_repo();
    core.unwatch_worktree(repo.path());
    settle(&events);

    repo.write_file("ignored-by-the-app.txt", "x\n");

    assert!(events.recv_timeout(QUIET).is_err());
}

#[test]
fn watching_a_folder_that_is_not_a_repository_reports_it() {
    let folder = tempfile::tempdir().expect("temp dir");
    let (core, _events) = core_with_events();

    let error = core
        .watch_worktree(folder.path())
        .expect_err("not a repository");

    assert!(matches!(
        error,
        rebasar_core::ApiError::NotARepository { .. }
    ));
}
