use std::fs;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use rebasar_core::{
    ChangeKind, Core, CoreEvent, FileChange, MutationId, MutationOutcome, OutputStream,
};
use rebasar_testkit::TempRepo;

const BLOCK_UNTIL_RELEASED: &str =
    "echo hook-running >&2\nwhile [ ! -f release.flag ]; do sleep 0.1; done";

struct Harness {
    core: Arc<Core>,
    events: Arc<Mutex<Vec<CoreEvent>>>,
}

impl Harness {
    fn new() -> Self {
        let events = Arc::new(Mutex::new(Vec::new()));
        let sink = Arc::clone(&events);
        let core = Core::new(move |event| sink.lock().unwrap().push(event));
        Self {
            core: Arc::new(core),
            events,
        }
    }

    fn events(&self) -> Vec<CoreEvent> {
        self.events.lock().unwrap().clone()
    }

    fn count(&self, matches: impl Fn(&CoreEvent) -> bool) -> usize {
        self.events().iter().filter(|event| matches(event)).count()
    }

    fn wait_for_count(&self, expected: usize, matches: impl Fn(&CoreEvent) -> bool) {
        wait_until(|| self.count(&matches) >= expected);
    }

    fn started_ids(&self) -> Vec<MutationId> {
        self.events()
            .iter()
            .filter_map(|event| match event {
                CoreEvent::MutationStarted { mutation_id } => Some(*mutation_id),
                _ => None,
            })
            .collect()
    }

    fn output_of(&self, stream: OutputStream) -> Vec<String> {
        self.events()
            .into_iter()
            .filter_map(|event| match event {
                CoreEvent::MutationOutput {
                    stream: seen, text, ..
                } if seen == stream => Some(text),
                _ => None,
            })
            .collect()
    }

    /// Runs `work` on another thread, as the app does for every command.
    fn in_background<T: Send + 'static>(
        &self,
        work: impl FnOnce(Arc<Core>) -> T + Send + 'static,
    ) -> thread::JoinHandle<T> {
        let core = Arc::clone(&self.core);
        thread::spawn(move || work(core))
    }
}

fn is_started(event: &CoreEvent) -> bool {
    matches!(event, CoreEvent::MutationStarted { .. })
}

fn is_queued(event: &CoreEvent) -> bool {
    matches!(event, CoreEvent::MutationQueued { .. })
}

fn is_finished(event: &CoreEvent) -> bool {
    matches!(event, CoreEvent::MutationFinished { .. })
}

fn wait_until(condition: impl Fn() -> bool) {
    let deadline = Instant::now() + Duration::from_secs(20);
    while !condition() {
        assert!(Instant::now() < deadline, "timed out waiting");
        thread::sleep(Duration::from_millis(20));
    }
}

fn release(repo: &TempRepo) {
    fs::write(repo.path().join("release.flag"), "").expect("write release flag");
}

fn repo_with_initial_commit() -> TempRepo {
    let repo = TempRepo::init("sample");
    repo.commit_file("README.md", "one\n", "Initial commit");
    repo
}

fn repo_with_blocking_commit_hook() -> TempRepo {
    let repo = repo_with_initial_commit();
    repo.install_hook("pre-commit", BLOCK_UNTIL_RELEASED);
    repo.write_file("staged.txt", "x\n").stage("staged.txt");
    repo
}

fn paths(changes: &[FileChange]) -> Vec<&str> {
    changes.iter().map(|change| change.path.as_str()).collect()
}

fn one(path: &str) -> Vec<String> {
    vec![path.to_owned()]
}

#[test]
fn staging_a_file_moves_it_from_unstaged_to_staged() {
    let repo = repo_with_initial_commit();
    repo.write_file("notes.txt", "a\n")
        .write_file("other.txt", "b\n");
    let core = Core::new(|_| {});

    let outcome = core.stage(repo.path(), &one("notes.txt")).expect("stage");

    let status = core.worktree_status(repo.path()).expect("status");
    assert_eq!(outcome, MutationOutcome::Succeeded);
    assert_eq!(paths(&status.staged), ["notes.txt"]);
    assert_eq!(status.staged[0].kind, ChangeKind::Added);
    assert_eq!(paths(&status.unstaged), ["other.txt"]);
}

#[test]
fn staging_a_deleted_file_stages_the_deletion() {
    let repo = repo_with_initial_commit();
    repo.delete_file("README.md");
    let core = Core::new(|_| {});

    core.stage(repo.path(), &one("README.md")).expect("stage");

    let status = core.worktree_status(repo.path()).expect("status");
    assert_eq!(status.staged[0].kind, ChangeKind::Deleted);
    assert!(status.unstaged.is_empty());
}

#[test]
fn a_file_name_that_looks_like_a_pathspec_is_staged_literally() {
    let repo = repo_with_initial_commit();
    repo.write_file("[a].txt", "a\n").write_file("a.txt", "b\n");
    let core = Core::new(|_| {});

    core.stage(repo.path(), &one("[a].txt")).expect("stage");

    let status = core.worktree_status(repo.path()).expect("status");
    assert_eq!(paths(&status.staged), ["[a].txt"]);
    assert_eq!(paths(&status.unstaged), ["a.txt"]);
}

#[test]
fn staging_no_files_stages_nothing() {
    let repo = repo_with_initial_commit();
    repo.write_file("notes.txt", "a\n");
    let core = Core::new(|_| {});

    core.stage(repo.path(), &[]).expect("stage");

    let status = core.worktree_status(repo.path()).expect("status");
    assert!(status.staged.is_empty());
}

#[test]
fn unstaging_a_file_moves_it_back_to_unstaged() {
    let repo = repo_with_initial_commit();
    repo.write_file("README.md", "changed\n")
        .stage("README.md")
        .write_file("notes.txt", "a\n")
        .stage("notes.txt");
    let core = Core::new(|_| {});

    let outcome = core
        .unstage(repo.path(), &one("notes.txt"))
        .expect("unstage");

    let status = core.worktree_status(repo.path()).expect("status");
    assert_eq!(outcome, MutationOutcome::Succeeded);
    assert_eq!(paths(&status.staged), ["README.md"]);
    assert_eq!(paths(&status.unstaged), ["notes.txt"]);
}

#[test]
fn unstaging_works_before_the_first_commit() {
    let repo = TempRepo::init("fresh");
    repo.write_file("notes.txt", "a\n").stage("notes.txt");
    let core = Core::new(|_| {});

    let outcome = core
        .unstage(repo.path(), &one("notes.txt"))
        .expect("unstage");

    let status = core.worktree_status(repo.path()).expect("status");
    assert_eq!(outcome, MutationOutcome::Succeeded);
    assert!(status.staged.is_empty());
    assert_eq!(paths(&status.unstaged), ["notes.txt"]);
}

#[test]
fn unstaging_a_rename_needs_both_of_its_paths() {
    let repo = repo_with_initial_commit();
    repo.git(&["mv", "README.md", "GUIDE.md"]);
    let core = Core::new(|_| {});

    core.unstage(
        repo.path(),
        &["GUIDE.md".to_owned(), "README.md".to_owned()],
    )
    .expect("unstage");

    let status = core.worktree_status(repo.path()).expect("status");
    assert!(status.staged.is_empty());
}

#[test]
fn a_commit_records_the_staged_files_with_the_message() {
    let repo = repo_with_initial_commit();
    repo.write_file("notes.txt", "a\n").stage("notes.txt");
    repo.write_file("left.txt", "b\n");
    let core = Core::new(|_| {});

    let outcome = core
        .commit(repo.path(), "Add notes\n\nWith a body.")
        .expect("commit");

    let status = core.worktree_status(repo.path()).expect("status");
    assert_eq!(outcome, MutationOutcome::Succeeded);
    assert!(status.staged.is_empty());
    assert_eq!(paths(&status.unstaged), ["left.txt"]);
    assert_eq!(
        repo.git(&["log", "-1", "--format=%B"]).trim(),
        "Add notes\n\nWith a body."
    );
}

#[test]
fn a_commit_with_nothing_staged_fails() {
    let repo = repo_with_initial_commit();
    let harness = Harness::new();

    let outcome = harness.core.commit(repo.path(), "Nothing").expect("commit");

    assert_eq!(outcome, MutationOutcome::Failed { exit_code: Some(1) });
}

#[test]
fn a_mutation_reports_its_lifecycle_and_that_the_worktree_changed() {
    let repo = repo_with_initial_commit();
    repo.write_file("notes.txt", "a\n");
    let harness = Harness::new();

    harness
        .core
        .stage(repo.path(), &one("notes.txt"))
        .expect("stage");

    let kinds: Vec<&str> = harness
        .events()
        .iter()
        .map(|event| match event {
            CoreEvent::MutationQueued { mutation } => {
                assert_eq!(mutation.title, "Stage notes.txt");
                "queued"
            }
            CoreEvent::MutationStarted { .. } => "started",
            CoreEvent::MutationFinished { outcome, .. } => {
                assert_eq!(*outcome, MutationOutcome::Succeeded);
                "finished"
            }
            CoreEvent::WorktreeChanged { .. } => "worktree changed",
            other => panic!("unexpected event {other:?}"),
        })
        .collect();
    assert_eq!(kinds, ["queued", "started", "finished", "worktree changed"]);
}

#[test]
fn hook_output_streams_while_the_mutation_runs() {
    let repo = repo_with_blocking_commit_hook();
    let harness = Harness::new();
    let path = repo.path().to_owned();
    let commit = harness.in_background(move |core| core.commit(&path, "Add staged"));

    wait_until(|| {
        harness
            .output_of(OutputStream::Stderr)
            .contains(&"hook-running".to_owned())
    });

    assert_eq!(harness.count(is_finished), 0);
    release(&repo);
    assert_eq!(commit.join().unwrap().unwrap(), MutationOutcome::Succeeded);
}

#[test]
fn a_failing_hook_fails_the_mutation_and_its_message_is_reported() {
    let repo = repo_with_initial_commit();
    repo.install_hook(
        "pre-commit",
        "echo 'lint failed: no tabs please' >&2\nexit 3",
    );
    repo.write_file("notes.txt", "a\n").stage("notes.txt");
    let harness = Harness::new();

    let outcome = harness
        .core
        .commit(repo.path(), "Add notes")
        .expect("commit");

    assert_eq!(outcome, MutationOutcome::Failed { exit_code: Some(1) });
    assert!(harness
        .output_of(OutputStream::Stderr)
        .contains(&"lint failed: no tabs please".to_owned()));
    assert!(harness.events().iter().any(|event| matches!(
        event,
        CoreEvent::MutationFinished {
            outcome: MutationOutcome::Failed { .. },
            ..
        }
    )));
}

#[test]
fn git_runs_without_a_terminal_to_prompt_on() {
    let repo = repo_with_initial_commit();
    repo.install_hook(
        "pre-commit",
        "if read answer; then echo got-input; else echo no-input; fi >&2\necho \"prompts=$GIT_TERMINAL_PROMPT\" >&2",
    );
    repo.write_file("notes.txt", "a\n").stage("notes.txt");
    let harness = Harness::new();

    harness
        .core
        .commit(repo.path(), "Add notes")
        .expect("commit");

    let output = harness.output_of(OutputStream::Stderr);
    assert!(output.contains(&"no-input".to_owned()), "{output:?}");
    assert!(output.contains(&"prompts=0".to_owned()), "{output:?}");
}

#[test]
fn mutations_on_one_repository_run_one_at_a_time_in_arrival_order_across_its_worktrees() {
    let repo = repo_with_blocking_commit_hook();
    let linked = repo.add_worktree("linked", "feature");
    fs::write(linked.join("new.txt"), "n\n").expect("write file");
    let harness = Harness::new();

    let main_path = repo.path().to_owned();
    let commit = harness.in_background(move |core| core.commit(&main_path, "Add staged"));
    harness.wait_for_count(1, is_started);
    let linked_path = linked.clone();
    let stage = harness.in_background(move |core| core.stage(&linked_path, &one("new.txt")));
    harness.wait_for_count(2, is_queued);

    thread::sleep(Duration::from_millis(300));
    assert_eq!(harness.started_ids().len(), 1, "the second one must wait");
    release(&repo);
    commit.join().unwrap().unwrap();
    stage.join().unwrap().unwrap();

    let order: Vec<&str> = harness
        .events()
        .iter()
        .filter_map(|event| match event {
            CoreEvent::MutationQueued { mutation } => Some(match mutation.title.as_str() {
                "Commit" => "queued commit",
                _ => "queued stage",
            }),
            CoreEvent::MutationStarted { mutation_id } => {
                Some(if *mutation_id == harness.started_ids()[0] {
                    "started commit"
                } else {
                    "started stage"
                })
            }
            CoreEvent::MutationFinished { mutation_id, .. } => {
                Some(if *mutation_id == harness.started_ids()[0] {
                    "finished commit"
                } else {
                    "finished stage"
                })
            }
            _ => None,
        })
        .collect();
    assert_eq!(
        order,
        [
            "queued commit",
            "started commit",
            "queued stage",
            "finished commit",
            "started stage",
            "finished stage",
        ]
    );
}

#[test]
fn queued_mutations_start_in_the_order_they_were_requested() {
    let repo = repo_with_blocking_commit_hook();
    for name in ["a.txt", "b.txt", "c.txt"] {
        repo.write_file(name, "x\n");
    }
    let harness = Harness::new();

    let main_path = repo.path().to_owned();
    let commit = harness.in_background(move |core| core.commit(&main_path, "Add staged"));
    harness.wait_for_count(1, is_started);
    let mut stages = Vec::new();
    for (index, name) in ["a.txt", "b.txt", "c.txt"].into_iter().enumerate() {
        let path = repo.path().to_owned();
        stages.push(harness.in_background(move |core| core.stage(&path, &one(name))));
        harness.wait_for_count(index + 2, is_queued);
    }
    release(&repo);
    commit.join().unwrap().unwrap();
    for stage in stages {
        stage.join().unwrap().unwrap();
    }

    let titles: Vec<String> = harness
        .events()
        .into_iter()
        .filter_map(|event| match event {
            CoreEvent::MutationQueued { mutation } => Some(mutation.title),
            _ => None,
        })
        .collect();
    let started: Vec<MutationId> = harness.started_ids();
    let queued: Vec<MutationId> = harness
        .events()
        .into_iter()
        .filter_map(|event| match event {
            CoreEvent::MutationQueued { mutation } => Some(mutation.id),
            _ => None,
        })
        .collect();
    assert_eq!(
        titles,
        ["Commit", "Stage a.txt", "Stage b.txt", "Stage c.txt"]
    );
    assert_eq!(started, queued);
}

#[test]
fn reads_and_other_repositories_are_not_held_up_by_a_running_mutation() {
    let busy = repo_with_blocking_commit_hook();
    let other = repo_with_initial_commit();
    other.write_file("notes.txt", "a\n");
    let harness = Harness::new();

    let busy_path = busy.path().to_owned();
    let commit = harness.in_background(move |core| core.commit(&busy_path, "Add staged"));
    harness.wait_for_count(1, is_started);

    let status = harness.core.worktree_status(busy.path()).expect("status");
    let outcome = harness
        .core
        .stage(other.path(), &one("notes.txt"))
        .expect("stage");

    assert_eq!(paths(&status.staged), ["staged.txt"]);
    assert_eq!(outcome, MutationOutcome::Succeeded);
    assert_eq!(harness.count(is_finished), 1);
    release(&busy);
    commit.join().unwrap().unwrap();
}

#[test]
fn cancelling_a_running_mutation_ends_git_and_its_hooks_and_frees_the_queue() {
    let repo = repo_with_blocking_commit_hook();
    repo.write_file("later.txt", "l\n");
    let harness = Harness::new();

    let path = repo.path().to_owned();
    let commit = harness.in_background(move |core| core.commit(&path, "Add staged"));
    harness.wait_for_count(1, is_started);
    let path = repo.path().to_owned();
    let later = harness.in_background(move |core| core.stage(&path, &one("later.txt")));
    harness.wait_for_count(2, is_queued);

    harness.core.cancel_mutation(harness.started_ids()[0]);

    assert_eq!(commit.join().unwrap().unwrap(), MutationOutcome::Cancelled);
    assert_eq!(later.join().unwrap().unwrap(), MutationOutcome::Succeeded);
    assert_eq!(repo.git(&["log", "--format=%s"]).trim(), "Initial commit");
}

#[test]
fn cancelling_a_queued_mutation_means_it_never_runs() {
    let repo = repo_with_blocking_commit_hook();
    repo.write_file("later.txt", "l\n");
    let harness = Harness::new();

    let path = repo.path().to_owned();
    let commit = harness.in_background(move |core| core.commit(&path, "Add staged"));
    harness.wait_for_count(1, is_started);
    let path = repo.path().to_owned();
    let later = harness.in_background(move |core| core.stage(&path, &one("later.txt")));
    harness.wait_for_count(2, is_queued);
    let queued_id = harness
        .events()
        .iter()
        .find_map(|event| match event {
            CoreEvent::MutationQueued { mutation } if mutation.title.starts_with("Stage") => {
                Some(mutation.id)
            }
            _ => None,
        })
        .expect("queued stage");

    harness.core.cancel_mutation(queued_id);

    assert_eq!(later.join().unwrap().unwrap(), MutationOutcome::Cancelled);
    assert_eq!(harness.started_ids().len(), 1);
    release(&repo);
    assert_eq!(commit.join().unwrap().unwrap(), MutationOutcome::Succeeded);
    let status = harness.core.worktree_status(repo.path()).expect("status");
    assert_eq!(paths(&status.unstaged), ["later.txt", "release.flag"]);
}

#[test]
fn cancelling_a_finished_mutation_does_nothing() {
    let repo = repo_with_initial_commit();
    repo.write_file("notes.txt", "a\n");
    let harness = Harness::new();
    harness
        .core
        .stage(repo.path(), &one("notes.txt"))
        .expect("stage");

    harness.core.cancel_mutation(harness.started_ids()[0]);

    assert!(harness.events().iter().all(|event| !matches!(
        event,
        CoreEvent::MutationFinished {
            outcome: MutationOutcome::Cancelled,
            ..
        }
    )));
}

#[test]
fn a_line_ended_by_a_carriage_return_is_reported_as_a_progress_update() {
    let repo = repo_with_initial_commit();
    repo.install_hook(
        "pre-commit",
        "printf 'progress 1%%\\rprogress 2%%\\rdone\\r\\nnext\\n'",
    );
    repo.write_file("notes.txt", "a\n").stage("notes.txt");
    let harness = Harness::new();

    harness
        .core
        .commit(repo.path(), "Add notes")
        .expect("commit");

    let lines: Vec<(String, bool)> = harness
        .events()
        .into_iter()
        .filter_map(|event| match event {
            CoreEvent::MutationOutput {
                text, transient, ..
            } if text.starts_with("progress") || text == "done" || text == "next" => {
                Some((text, transient))
            }
            _ => None,
        })
        .collect();
    assert_eq!(
        lines,
        [
            ("progress 1%".to_owned(), true),
            ("progress 2%".to_owned(), true),
            ("done".to_owned(), false),
            ("next".to_owned(), false),
        ]
    );
}

#[test]
fn mutating_a_folder_that_is_not_a_repository_is_an_error() {
    let folder = tempfile::tempdir().expect("temp dir");
    let core = Core::new(|_| {});

    let result = core.stage(folder.path(), &one("x"));

    assert!(matches!(
        result,
        Err(rebasar_core::ApiError::NotARepository { .. })
    ));
}
