use rebasar_core::{
    Assessment, Core, MutationKind, MutationOutcome, OperationKind, ResetMode,
};
use rebasar_testkit::TempRepo;

fn core() -> Core {
    Core::new(|_| {})
}

fn ok(outcome: Result<MutationOutcome, rebasar_core::ApiError>) {
    assert_eq!(outcome.expect("runs"), MutationOutcome::Succeeded);
}

fn id_of(repo: &TempRepo, revision: &str) -> String {
    repo.git(&["rev-parse", revision]).trim().to_owned()
}

fn subjects(repo: &TempRepo) -> Vec<String> {
    repo.git(&["log", "--format=%s"]).lines().map(str::to_owned).collect()
}

/// Base, A, B on `main`.
fn history() -> TempRepo {
    let repo = TempRepo::init("sample");
    repo.commit_file("base.txt", "base\n", "Base");
    repo.commit_file("a.txt", "a\n", "A");
    repo.commit_file("b.txt", "b\n", "B");
    repo
}

fn reset(commit: &str, mode: ResetMode) -> MutationKind {
    MutationKind::Reset { commit: commit.to_owned(), mode }
}

#[test]
fn cherry_picking_applies_the_commit_on_top_of_head() {
    let repo = history();
    repo.create_branch("topic");
    repo.commit_file("t.txt", "t\n", "Topic work");
    let picked = id_of(&repo, "HEAD");
    repo.checkout("main");

    ok(core().cherry_pick_commit(repo.path(), &picked));

    assert_eq!(subjects(&repo)[0], "Topic work");
    assert!(repo.path().join("t.txt").exists());
}

#[test]
fn a_cherry_pick_that_conflicts_leaves_the_worktree_paused_for_the_banner() {
    let repo = TempRepo::init("sample");
    repo.commit_file("a.txt", "one\n", "Base");
    repo.create_branch("topic");
    repo.commit_file("a.txt", "topic\n", "Topic edit");
    let picked = id_of(&repo, "HEAD");
    repo.checkout("main");
    repo.commit_file("a.txt", "main\n", "Main edit");

    let outcome = core().cherry_pick_commit(repo.path(), &picked).unwrap();

    assert!(matches!(outcome, MutationOutcome::Failed { .. }));
    let paused = core().operation_in_progress(repo.path()).unwrap().expect("paused");
    assert_eq!((paused.kind, paused.conflicts), (OperationKind::CherryPick, 1));
}

#[test]
fn reverting_adds_a_commit_that_undoes_the_given_one() {
    let repo = history();
    let target = id_of(&repo, "HEAD~1");

    ok(core().revert_commit(repo.path(), &target));

    assert_eq!(subjects(&repo)[0], "Revert \"A\"");
    assert!(!repo.path().join("a.txt").exists());
    assert!(repo.path().join("b.txt").exists());
}

#[test]
fn a_revert_that_conflicts_leaves_the_worktree_paused() {
    let repo = TempRepo::init("sample");
    repo.commit_file("a.txt", "one\n", "Base");
    repo.commit_file("a.txt", "two\n", "Edit one");
    let target = id_of(&repo, "HEAD");
    repo.commit_file("a.txt", "three\n", "Edit two");

    let outcome = core().revert_commit(repo.path(), &target).unwrap();

    assert!(matches!(outcome, MutationOutcome::Failed { .. }));
    assert_eq!(
        core().operation_in_progress(repo.path()).unwrap().map(|op| op.kind),
        Some(OperationKind::Revert)
    );
}

#[test]
fn a_merge_commit_can_be_reverted_against_its_first_parent() {
    let repo = TempRepo::init("sample");
    repo.commit_file("a.txt", "a\n", "A");
    repo.create_branch("topic");
    repo.commit_file("t.txt", "t\n", "Topic");
    repo.checkout("main");
    repo.commit_file("m.txt", "m\n", "Main");
    repo.git(&["merge", "--no-ff", "-m", "Merge topic", "topic"]);
    let merge = id_of(&repo, "HEAD");

    ok(core().revert_commit(repo.path(), &merge));

    assert!(!repo.path().join("t.txt").exists());
    assert!(repo.path().join("m.txt").exists());
}

#[test]
fn something_that_is_not_a_commit_id_is_rejected_before_git_runs() {
    let repo = history();

    assert!(core().cherry_pick_commit(repo.path(), "--abort").is_err());
    assert!(core().revert_commit(repo.path(), "HEAD").is_err());
    assert!(core().reset_to_commit(repo.path(), "--hard", ResetMode::Hard).is_err());
}

#[test]
fn a_soft_reset_keeps_the_changes_staged() {
    let repo = history();
    let target = id_of(&repo, "HEAD~1");

    ok(core().reset_to_commit(repo.path(), &target, ResetMode::Soft));

    assert_eq!(subjects(&repo), ["A", "Base"]);
    assert_eq!(repo.git(&["diff", "--cached", "--name-only"]).trim(), "b.txt");
}

#[test]
fn a_mixed_reset_keeps_the_changes_as_unstaged_work() {
    let repo = history();
    let target = id_of(&repo, "HEAD~1");

    ok(core().reset_to_commit(repo.path(), &target, ResetMode::Mixed));

    assert_eq!(repo.git(&["diff", "--cached", "--name-only"]).trim(), "");
    assert_eq!(repo.git(&["status", "--porcelain"]).trim(), "?? b.txt");
}

#[test]
fn a_hard_reset_discards_the_changes_too() {
    let repo = history();
    let target = id_of(&repo, "HEAD~1");

    ok(core().reset_to_commit(repo.path(), &target, ResetMode::Hard));

    assert_eq!(subjects(&repo), ["A", "Base"]);
    assert!(!repo.path().join("b.txt").exists());
}

#[test]
fn resetting_to_head_with_a_clean_tree_loses_nothing() {
    let repo = history();
    let head = id_of(&repo, "HEAD");

    for mode in [ResetMode::Soft, ResetMode::Mixed, ResetMode::Hard] {
        assert_eq!(
            core().assess_mutation(repo.path(), &reset(&head, mode)).unwrap(),
            Assessment::Safe,
            "{mode:?}"
        );
    }
}

#[test]
fn every_reset_that_drops_commits_names_them() {
    let repo = history();
    let target = id_of(&repo, "HEAD~2");

    for mode in [ResetMode::Soft, ResetMode::Mixed, ResetMode::Hard] {
        let Assessment::Destructive { loss } =
            core().assess_mutation(repo.path(), &reset(&target, mode)).unwrap()
        else {
            panic!("{mode:?} drops two commits");
        };
        assert_eq!((loss.commits, loss.unpushed_commits), (2, 2), "{mode:?}");
        assert!(loss.files.is_empty());
    }
}

#[test]
fn commits_another_branch_or_a_remote_still_holds_are_not_counted_as_lost() {
    let repo = history();
    repo.add_bare_remote("origin");
    repo.git(&["push", "origin", "main"]);
    repo.git(&["fetch", "origin"]);
    let target = id_of(&repo, "HEAD~2");

    assert_eq!(
        core().assess_mutation(repo.path(), &reset(&target, ResetMode::Hard)).unwrap(),
        Assessment::Safe
    );

    repo.commit_file("c.txt", "c\n", "C");
    let Assessment::Destructive { loss } =
        core().assess_mutation(repo.path(), &reset(&target, ResetMode::Soft)).unwrap()
    else {
        panic!("C exists nowhere else");
    };
    assert_eq!(loss.commits, 1);
}

#[test]
fn a_hard_reset_names_the_uncommitted_files_it_would_overwrite() {
    let repo = history();
    let head = id_of(&repo, "HEAD");
    repo.write_file("a.txt", "edited\n");
    repo.write_file("untouched-by-reset.txt", "untracked\n");

    let Assessment::Destructive { loss } =
        core().assess_mutation(repo.path(), &reset(&head, ResetMode::Hard)).unwrap()
    else {
        panic!("a tracked file has uncommitted edits");
    };
    assert_eq!(loss.files.iter().map(|file| file.path.as_str()).collect::<Vec<_>>(), ["a.txt"]);
    assert_eq!(
        core().assess_mutation(repo.path(), &reset(&head, ResetMode::Soft)).unwrap(),
        Assessment::Safe,
        "a soft reset leaves the working tree alone"
    );
}

#[test]
fn resetting_forward_to_a_descendant_drops_nothing() {
    let repo = history();
    let tip = id_of(&repo, "HEAD");
    repo.git(&["reset", "--hard", "HEAD~2"]);

    assert_eq!(
        core().assess_mutation(repo.path(), &reset(&tip, ResetMode::Hard)).unwrap(),
        Assessment::Safe
    );
}
