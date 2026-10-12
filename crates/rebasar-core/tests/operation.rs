use rebasar_core::{
    Assessment, Core, MutationKind, MutationOutcome, OperationInProgress, OperationKind,
    OperationStep,
};
use rebasar_testkit::TempRepo;

/// `main` and `topic` both rewrite the middle line of `a.txt`, so integrating one into the
/// other stops on a conflict. HEAD is left on `main`.
fn diverged() -> TempRepo {
    let repo = TempRepo::init("sample");
    repo.commit_file("a.txt", "one\ntwo\nthree\n", "Initial commit");
    repo.create_branch("topic");
    repo.commit_file("a.txt", "one\nfrom topic\nthree\n", "Topic edit");
    repo.checkout("main");
    repo.commit_file("a.txt", "one\nfrom main\nthree\n", "Main edit");
    repo
}

fn state_of(core: &Core, repo: &TempRepo) -> Option<OperationInProgress> {
    core.operation_in_progress(repo.path()).expect("operation")
}

fn resolve(repo: &TempRepo) {
    repo.write_file("a.txt", "one\nresolved\nthree\n");
    repo.stage("a.txt");
}

#[test]
fn a_clean_worktree_has_no_operation_in_progress() {
    let repo = diverged();

    assert_eq!(state_of(&Core::new(|_| {}), &repo), None);
}

#[test]
fn a_merge_stopped_on_a_conflict_is_detected_with_its_conflicts() {
    let repo = diverged();
    repo.git_fails(&["merge", "topic"]);

    let state = state_of(&Core::new(|_| {}), &repo).expect("paused");

    assert_eq!(
        state,
        OperationInProgress {
            kind: OperationKind::Merge,
            step: None,
            conflicts: 1,
            can_skip: false,
        }
    );
}

#[test]
fn a_rebase_stopped_on_a_conflict_reports_which_commit_it_is_on() {
    let repo = diverged();
    repo.checkout("topic");
    repo.git_fails(&["rebase", "main"]);

    let state = state_of(&Core::new(|_| {}), &repo).expect("paused");

    assert_eq!(state.kind, OperationKind::Rebase);
    assert_eq!(state.step, Some(OperationStep { current: 1, total: 1 }));
    assert_eq!(state.conflicts, 1);
    assert!(state.can_skip);
}

#[test]
fn a_cherry_pick_stopped_on_a_conflict_is_detected() {
    let repo = diverged();
    repo.git_fails(&["cherry-pick", "topic"]);

    let state = state_of(&Core::new(|_| {}), &repo).expect("paused");

    assert_eq!(state.kind, OperationKind::CherryPick);
    assert_eq!(state.conflicts, 1);
}

#[test]
fn a_revert_stopped_on_a_conflict_is_detected() {
    let repo = diverged();
    let first = repo.git(&["rev-parse", "HEAD~1"]);
    repo.git_fails(&["revert", first.trim()]);

    let state = state_of(&Core::new(|_| {}), &repo).expect("paused");

    assert_eq!(state.kind, OperationKind::Revert);
}

#[test]
fn an_operation_started_in_a_linked_worktree_is_found_there_and_not_in_the_main_one() {
    let repo = diverged();
    let linked = repo.add_worktree("linked", "side");
    let status = std::process::Command::new("git")
        .args(["merge", "topic"])
        .current_dir(&linked)
        .status()
        .expect("run git");
    assert!(!status.success());
    let core = Core::new(|_| {});

    assert_eq!(core.operation_in_progress(&linked).unwrap().map(|op| op.kind), Some(OperationKind::Merge));
    assert_eq!(state_of(&core, &repo), None);
}

#[test]
fn continuing_a_merge_after_resolving_finishes_it() {
    let repo = diverged();
    repo.git_fails(&["merge", "topic"]);
    resolve(&repo);
    let core = Core::new(|_| {});

    assert_eq!(core.continue_operation(repo.path()).unwrap(), MutationOutcome::Succeeded);

    assert_eq!(state_of(&core, &repo), None);
    assert_eq!(repo.git(&["rev-list", "--parents", "-n", "1", "HEAD"]).split_whitespace().count(), 3);
}

#[test]
fn continuing_with_a_conflict_left_fails_and_keeps_the_operation() {
    let repo = diverged();
    repo.git_fails(&["merge", "topic"]);
    let core = Core::new(|_| {});

    let outcome = core.continue_operation(repo.path()).unwrap();

    assert!(matches!(outcome, MutationOutcome::Failed { .. }));
    assert!(state_of(&core, &repo).is_some());
}

#[test]
fn continuing_a_rebase_replays_the_rest_without_opening_an_editor() {
    let repo = diverged();
    repo.checkout("topic");
    repo.git_fails(&["rebase", "main"]);
    resolve(&repo);
    let core = Core::new(|_| {});

    assert_eq!(core.continue_operation(repo.path()).unwrap(), MutationOutcome::Succeeded);

    assert_eq!(state_of(&core, &repo), None);
    assert_eq!(repo.git(&["log", "--format=%s", "-1"]).trim(), "Topic edit");
}

#[test]
fn skipping_a_rebase_commit_drops_it() {
    let repo = diverged();
    repo.checkout("topic");
    repo.git_fails(&["rebase", "main"]);
    let core = Core::new(|_| {});

    assert_eq!(core.skip_operation(repo.path()).unwrap(), MutationOutcome::Succeeded);

    assert_eq!(state_of(&core, &repo), None);
    assert_eq!(repo.git(&["log", "--format=%s", "-1"]).trim(), "Main edit");
}

#[test]
fn a_merge_cannot_be_skipped() {
    let repo = diverged();
    repo.git_fails(&["merge", "topic"]);

    assert!(Core::new(|_| {}).skip_operation(repo.path()).is_err());
}

#[test]
fn aborting_restores_the_worktree_and_ends_the_operation() {
    let repo = diverged();
    repo.git_fails(&["merge", "topic"]);
    let core = Core::new(|_| {});

    assert_eq!(core.abort_operation(repo.path()).unwrap(), MutationOutcome::Succeeded);

    assert_eq!(state_of(&core, &repo), None);
    assert_eq!(repo.git(&["ls-files", "--unmerged"]).trim(), "");
    let content = std::fs::read_to_string(repo.path().join("a.txt")).unwrap();
    assert_eq!(content.replace("\r\n", "\n"), "one\nfrom main\nthree\n");
}

#[test]
fn continuing_when_nothing_is_in_progress_is_an_error() {
    let repo = diverged();

    assert!(Core::new(|_| {}).continue_operation(repo.path()).is_err());
}

#[test]
fn aborting_names_the_conflicted_files_that_would_be_lost() {
    let repo = diverged();
    repo.git_fails(&["merge", "topic"]);
    let core = Core::new(|_| {});

    let assessment = core
        .assess_mutation(repo.path(), &MutationKind::AbortOperation)
        .unwrap();

    let Assessment::Destructive { loss } = assessment else {
        panic!("aborting a conflicted merge loses work");
    };
    assert_eq!(loss.files.iter().map(|file| file.path.as_str()).collect::<Vec<_>>(), ["a.txt"]);
}

#[test]
fn aborting_a_rebase_counts_the_commits_it_had_replayed() {
    let repo = TempRepo::init("sample");
    repo.commit_file("a.txt", "one\ntwo\nthree\n", "Initial commit");
    repo.create_branch("topic");
    repo.commit_file("b.txt", "replayed\n", "Replayed cleanly");
    repo.commit_file("a.txt", "one\nfrom topic\nthree\n", "Conflicts");
    repo.checkout("main");
    repo.commit_file("a.txt", "one\nfrom main\nthree\n", "Main edit");
    repo.checkout("topic");
    repo.git_fails(&["rebase", "main"]);
    let core = Core::new(|_| {});

    let Assessment::Destructive { loss } = core
        .assess_mutation(repo.path(), &MutationKind::AbortOperation)
        .unwrap()
    else {
        panic!("aborting a rebase loses work");
    };

    assert_eq!(loss.commits, 1);
    assert_eq!(loss.unpushed_commits, 1);
}

#[test]
fn aborting_when_nothing_is_in_progress_is_safe() {
    let repo = diverged();

    assert_eq!(
        Core::new(|_| {})
            .assess_mutation(repo.path(), &MutationKind::AbortOperation)
            .unwrap(),
        Assessment::Safe
    );
}
