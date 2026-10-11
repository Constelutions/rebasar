use std::fs;

use rebasar_core::{Assessment, ChangeKind, Core, Loss, MutationKind, MutationOutcome};
use rebasar_testkit::TempRepo;

fn repo_with_initial_commit() -> TempRepo {
    let repo = TempRepo::init("sample");
    repo.commit_file("README.md", "one\ntwo\n", "Initial commit");
    repo.commit_file("keep.txt", "keep\n", "Add keep");
    repo
}

/// The system `git` the core runs may check files out with CRLF.
fn read_lf(repo: &TempRepo, name: &str) -> String {
    fs::read_to_string(repo.path().join(name))
        .unwrap()
        .replace("\r\n", "\n")
}

fn paths(names: &[&str]) -> Vec<String> {
    names.iter().map(|name| (*name).to_owned()).collect()
}

fn discard(names: &[&str]) -> MutationKind {
    MutationKind::DiscardChanges {
        paths: paths(names),
    }
}

fn loss_of(core: &Core, repo: &TempRepo, kind: MutationKind) -> Loss {
    match core.assess_mutation(repo.path(), &kind).expect("assess") {
        Assessment::Destructive { loss } => loss,
        Assessment::Safe => panic!("expected a destructive assessment"),
    }
}

#[test]
fn staging_unstaging_and_committing_are_safe() {
    let repo = repo_with_initial_commit();
    repo.write_file("notes.txt", "a\n");
    let core = Core::new(|_| {});

    for kind in [
        MutationKind::Stage,
        MutationKind::Unstage,
        MutationKind::Commit,
    ] {
        assert_eq!(
            core.assess_mutation(repo.path(), &kind).expect("assess"),
            Assessment::Safe,
            "{kind:?}"
        );
    }
}

#[test]
fn discarding_loses_the_unstaged_files_with_their_line_counts() {
    let repo = repo_with_initial_commit();
    repo.write_file("README.md", "one\nchanged\nextra\n")
        .delete_file("keep.txt")
        .write_file("notes.txt", "a\nb\nc\n");
    let core = Core::new(|_| {});

    let loss = loss_of(
        &core,
        &repo,
        discard(&["README.md", "keep.txt", "notes.txt"]),
    );

    let summary: Vec<_> = loss
        .files
        .iter()
        .map(|file| (file.path.as_str(), file.kind, file.added, file.removed))
        .collect();
    assert_eq!(
        summary,
        [
            ("README.md", ChangeKind::Modified, Some(2), Some(1)),
            ("keep.txt", ChangeKind::Deleted, Some(0), Some(1)),
            ("notes.txt", ChangeKind::Untracked, Some(3), Some(0)),
        ]
    );
    assert_eq!((loss.commits, loss.unpushed_commits), (0, 0));
}

#[test]
fn discarding_only_loses_the_files_asked_for() {
    let repo = repo_with_initial_commit();
    repo.write_file("README.md", "changed\n")
        .write_file("notes.txt", "a\n");
    let core = Core::new(|_| {});

    let loss = loss_of(&core, &repo, discard(&["notes.txt"]));

    assert_eq!(loss.files.len(), 1);
    assert_eq!(loss.files[0].path, "notes.txt");
}

#[test]
fn staged_changes_are_not_lost_by_a_discard() {
    let repo = repo_with_initial_commit();
    repo.write_file("README.md", "staged\n").stage("README.md");
    repo.write_file("README.md", "staged\nand more\n");
    let core = Core::new(|_| {});

    let loss = loss_of(&core, &repo, discard(&["README.md", "keep.txt"]));

    assert_eq!(loss.files.len(), 1);
    assert_eq!(
        (loss.files[0].added, loss.files[0].removed),
        (Some(1), Some(0)),
        "only the change on top of the staged version is lost"
    );
}

#[test]
fn discarding_nothing_that_changed_is_safe() {
    let repo = repo_with_initial_commit();
    repo.write_file("README.md", "staged\n").stage("README.md");
    let core = Core::new(|_| {});

    for kind in [discard(&[]), discard(&["README.md", "keep.txt", "missing"])] {
        assert_eq!(
            core.assess_mutation(repo.path(), &kind).expect("assess"),
            Assessment::Safe
        );
    }
}

#[test]
fn conflicted_files_are_not_lost_by_a_discard() {
    let repo = repo_with_initial_commit();
    repo.git(&["checkout", "-b", "other"]);
    repo.commit_file("README.md", "other side\n", "Other");
    repo.git(&["checkout", "main"]);
    repo.commit_file("README.md", "main side\n", "Main");
    repo.git_fails(&["merge", "other"]);
    let core = Core::new(|_| {});

    assert_eq!(
        core.assess_mutation(repo.path(), &discard(&["README.md"]))
            .expect("assess"),
        Assessment::Safe
    );
}

#[test]
fn discarding_restores_tracked_files_and_deletes_untracked_ones() {
    let repo = repo_with_initial_commit();
    repo.write_file("README.md", "changed\n")
        .delete_file("keep.txt")
        .write_file("notes.txt", "a\n")
        .write_file("dir/nested.txt", "n\n")
        .write_file("other.txt", "survives\n");
    let core = Core::new(|_| {});

    let outcome = core
        .discard_changes(
            repo.path(),
            &paths(&["README.md", "keep.txt", "notes.txt", "dir/nested.txt"]),
        )
        .expect("discard");

    assert_eq!(outcome, MutationOutcome::Succeeded);
    assert_eq!(read_lf(&repo, "README.md"), "one\ntwo\n");
    assert!(repo.path().join("keep.txt").exists());
    assert!(!repo.path().join("notes.txt").exists());
    assert!(!repo.path().join("dir/nested.txt").exists());
    assert!(repo.path().join("other.txt").exists());
}

#[test]
fn discarding_goes_back_to_the_staged_version_and_keeps_staged_changes() {
    let repo = repo_with_initial_commit();
    repo.write_file("README.md", "staged\n").stage("README.md");
    repo.write_file("README.md", "staged\nand more\n");
    repo.write_file("new.txt", "n\n").stage("new.txt");
    let core = Core::new(|_| {});

    core.discard_changes(repo.path(), &paths(&["README.md", "new.txt"]))
        .expect("discard");

    let status = core.worktree_status(repo.path()).expect("status");
    assert_eq!(read_lf(&repo, "README.md"), "staged\n");
    assert_eq!(status.staged.len(), 2);
    assert!(status.unstaged.is_empty());
}

#[test]
fn a_file_name_that_looks_like_a_pathspec_is_discarded_literally() {
    let repo = repo_with_initial_commit();
    repo.write_file("[a].txt", "a\n").write_file("a.txt", "b\n");
    let core = Core::new(|_| {});

    core.discard_changes(repo.path(), &paths(&["[a].txt"]))
        .expect("discard");

    assert!(!repo.path().join("[a].txt").exists());
    assert!(repo.path().join("a.txt").exists());
}

#[test]
fn discarding_a_great_many_files_is_split_into_commands_that_fit() {
    let repo = repo_with_initial_commit();
    let names: Vec<String> = (0..600)
        .map(|index| format!("generated/{}-{index}.txt", "x".repeat(60)))
        .collect();
    for name in &names {
        repo.write_file(name, "n\n");
    }
    let core = Core::new(|_| {});

    let outcome = core.discard_changes(repo.path(), &names).expect("discard");

    assert_eq!(outcome, MutationOutcome::Succeeded);
    assert!(core
        .worktree_status(repo.path())
        .expect("status")
        .unstaged
        .is_empty());
}

#[test]
fn discarding_a_file_that_changed_since_the_assessment_is_still_limited_to_unstaged_work() {
    let repo = repo_with_initial_commit();
    repo.write_file("README.md", "staged\n").stage("README.md");
    let core = Core::new(|_| {});

    let outcome = core
        .discard_changes(repo.path(), &paths(&["README.md"]))
        .expect("discard");

    assert_eq!(outcome, MutationOutcome::Succeeded);
    assert_eq!(read_lf(&repo, "README.md"), "staged\n");
}

#[test]
fn a_discard_runs_as_a_mutation_so_its_output_is_reported() {
    let repo = repo_with_initial_commit();
    repo.write_file("notes.txt", "a\n");
    let titles = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
    let sink = std::sync::Arc::clone(&titles);
    let core = Core::new(move |event| {
        if let rebasar_core::CoreEvent::MutationQueued { mutation } = event {
            sink.lock().unwrap().push(mutation.title);
        }
    });

    core.discard_changes(repo.path(), &paths(&["notes.txt"]))
        .expect("discard");

    assert_eq!(*titles.lock().unwrap(), ["Discard notes.txt"]);
}
