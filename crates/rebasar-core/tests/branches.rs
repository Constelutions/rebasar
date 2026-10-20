use rebasar_core::{
    Assessment, BranchInfo, BranchKind, Core, MergeMode, MutationKind, MutationOutcome,
    OperationKind,
};
use rebasar_testkit::TempRepo;

fn core() -> Core {
    Core::new(|_| {})
}

fn ok(outcome: Result<MutationOutcome, rebasar_core::ApiError>) {
    assert_eq!(outcome.expect("runs"), MutationOutcome::Succeeded);
}

fn branches(repo: &TempRepo) -> Vec<BranchInfo> {
    core().list_branch_details(repo.path()).expect("branches")
}

fn named<'a>(list: &'a [BranchInfo], name: &str) -> &'a BranchInfo {
    list.iter()
        .find(|branch| branch.name == name)
        .unwrap_or_else(|| panic!("no branch {name} in {list:?}"))
}

/// `main` has two commits and `topic` branched from the first and added one.
fn with_topic() -> TempRepo {
    let repo = TempRepo::init("sample");
    repo.commit_file("a.txt", "one\n", "Initial commit");
    repo.create_branch("topic");
    repo.commit_file("topic.txt", "topic\n", "Topic work");
    repo.checkout("main");
    repo.commit_file("b.txt", "main\n", "Main work");
    repo
}

#[test]
fn local_branches_are_listed_with_the_current_one_marked() {
    let repo = with_topic();

    let list = branches(&repo);

    assert_eq!(list.iter().map(|b| b.name.as_str()).collect::<Vec<_>>(), ["main", "topic"]);
    assert!(named(&list, "main").current);
    assert!(!named(&list, "topic").current);
    assert!(list.iter().all(|b| b.kind == BranchKind::Local));
}

#[test]
fn a_branch_is_merged_once_the_current_branch_contains_it() {
    let repo = with_topic();
    repo.create_branch("old");
    repo.checkout("main");

    let list = branches(&repo);

    assert!(named(&list, "old").merged, "points at a commit main contains");
    assert!(!named(&list, "topic").merged);
    assert!(named(&list, "main").merged);
}

#[test]
fn ahead_and_behind_are_counted_against_each_branchs_own_upstream() {
    let repo = TempRepo::init("sample");
    repo.add_bare_remote("origin");
    repo.commit_file("a.txt", "one\n", "Initial commit");
    repo.git(&["push", "--set-upstream", "origin", "main"]);
    repo.commit_file("b.txt", "two\n", "Local only");
    repo.create_branch("loose");

    let list = branches(&repo);

    let main = named(&list, "main");
    assert_eq!((main.upstream.as_deref(), main.ahead, main.behind), (Some("origin/main"), 1, 0));
    let loose = named(&list, "loose");
    assert_eq!((loose.upstream.as_deref(), loose.ahead, loose.behind), (None, 0, 0));
}

#[test]
fn remote_branches_are_listed_after_the_local_ones_without_the_remote_head() {
    let repo = TempRepo::init("sample");
    repo.add_bare_remote("origin");
    repo.commit_file("a.txt", "one\n", "Initial commit");
    repo.git(&["push", "origin", "main"]);
    repo.git(&["fetch", "origin"]);
    repo.git(&["remote", "set-head", "origin", "main"]);

    let list = branches(&repo);

    assert_eq!(
        list.iter().map(|b| (b.name.as_str(), b.kind)).collect::<Vec<_>>(),
        [("main", BranchKind::Local), ("origin/main", BranchKind::Remote)]
    );
}

#[test]
fn creating_a_branch_leaves_head_where_it_is_unless_asked_to_switch() {
    let repo = with_topic();

    ok(core().create_branch_here(repo.path(), "feature", false));
    assert!(named(&branches(&repo), "main").current);

    ok(core().create_branch_here(repo.path(), "other", true));
    assert!(named(&branches(&repo), "other").current);
}

#[test]
fn a_bad_branch_name_fails_without_creating_anything() {
    let repo = with_topic();

    let outcome = core().create_branch_here(repo.path(), "bad name", false).unwrap();

    assert!(matches!(outcome, MutationOutcome::Failed { .. }));
    assert!(core().create_branch_here(repo.path(), "--force", false).is_err());
    assert_eq!(branches(&repo).len(), 2);
}

#[test]
fn checking_out_a_branch_switches_to_it() {
    let repo = with_topic();

    ok(core().checkout_branch(repo.path(), "topic", false));

    assert!(named(&branches(&repo), "topic").current);
}

#[test]
fn checking_out_a_remote_branch_creates_a_local_one_tracking_it() {
    let repo = TempRepo::init("sample");
    repo.add_bare_remote("origin");
    repo.commit_file("a.txt", "one\n", "Initial commit");
    repo.create_branch("topic");
    repo.git(&["push", "origin", "topic"]);
    repo.checkout("main");
    repo.git(&["branch", "-D", "topic"]);
    repo.git(&["fetch", "origin"]);

    ok(core().checkout_branch(repo.path(), "origin/topic", true));

    let list = branches(&repo);
    let topic = named(&list, "topic");
    assert!(topic.current);
    assert_eq!(topic.upstream.as_deref(), Some("origin/topic"));
}

#[test]
fn checking_out_with_changes_that_would_be_overwritten_fails_and_stays_put() {
    let repo = with_topic();
    repo.checkout("topic");
    repo.commit_file("a.txt", "topic edit\n", "Edit a");
    repo.checkout("main");
    repo.write_file("a.txt", "uncommitted\n");

    let outcome = core().checkout_branch(repo.path(), "topic", false).unwrap();

    assert!(matches!(outcome, MutationOutcome::Failed { .. }));
    assert!(named(&branches(&repo), "main").current);
}

#[test]
fn renaming_changes_the_name() {
    let repo = with_topic();

    ok(core().rename_branch(repo.path(), "topic", "feature/topic"));

    let names: Vec<_> = branches(&repo).into_iter().map(|b| b.name).collect();
    assert_eq!(names, ["feature/topic", "main"]);
}

#[test]
fn setting_and_clearing_the_upstream() {
    let repo = TempRepo::init("sample");
    repo.add_bare_remote("origin");
    repo.commit_file("a.txt", "one\n", "Initial commit");
    repo.git(&["push", "origin", "main"]);
    repo.git(&["fetch", "origin"]);

    ok(core().set_branch_upstream(repo.path(), "main", Some("origin/main")));
    assert_eq!(named(&branches(&repo), "main").upstream.as_deref(), Some("origin/main"));

    ok(core().set_branch_upstream(repo.path(), "main", None));
    assert_eq!(named(&branches(&repo), "main").upstream, None);
}

#[test]
fn deleting_a_merged_branch_is_safe_and_removes_it() {
    let repo = with_topic();
    repo.create_branch("old");
    repo.checkout("main");
    let kind = MutationKind::DeleteBranch { name: "old".to_owned() };
    assert_eq!(core().assess_mutation(repo.path(), &kind).unwrap(), Assessment::Safe);

    ok(core().delete_branch(repo.path(), "old"));

    assert!(branches(&repo).iter().all(|b| b.name != "old"));
}

#[test]
fn deleting_an_unmerged_branch_names_the_commits_that_would_be_lost() {
    let repo = with_topic();
    let kind = MutationKind::DeleteBranch { name: "topic".to_owned() };

    let Assessment::Destructive { loss } = core().assess_mutation(repo.path(), &kind).unwrap() else {
        panic!("topic holds a commit nothing else has");
    };

    assert_eq!((loss.commits, loss.unpushed_commits), (1, 1));
    ok(core().delete_branch(repo.path(), "topic"));
    assert!(branches(&repo).iter().all(|b| b.name != "topic"));
}

#[test]
fn a_branch_whose_commits_are_on_a_remote_is_safe_to_delete() {
    let repo = with_topic();
    repo.add_bare_remote("origin");
    repo.git(&["push", "origin", "topic"]);
    repo.git(&["fetch", "origin"]);
    let kind = MutationKind::DeleteBranch { name: "topic".to_owned() };

    assert_eq!(core().assess_mutation(repo.path(), &kind).unwrap(), Assessment::Safe);
}

#[test]
fn the_current_branch_cannot_be_deleted() {
    let repo = with_topic();

    let outcome = core().delete_branch(repo.path(), "main").unwrap();

    assert!(matches!(outcome, MutationOutcome::Failed { .. }));
    assert!(branches(&repo).iter().any(|b| b.name == "main"));
}

#[test]
fn merging_fast_forwards_by_default_and_records_a_merge_commit_with_no_ff() {
    let repo = TempRepo::init("sample");
    repo.commit_file("a.txt", "one\n", "Initial commit");
    repo.create_branch("topic");
    repo.commit_file("t.txt", "t\n", "Topic work");
    repo.checkout("main");
    ok(core().merge_branch(repo.path(), "topic", MergeMode::Default));
    assert_eq!(repo.git(&["rev-list", "--parents", "-n", "1", "HEAD"]).split_whitespace().count(), 2);

    repo.git(&["reset", "--hard", "HEAD~1"]);
    ok(core().merge_branch(repo.path(), "topic", MergeMode::NoFastForward));

    assert_eq!(repo.git(&["rev-list", "--parents", "-n", "1", "HEAD"]).split_whitespace().count(), 3);
}

#[test]
fn a_squash_merge_stages_the_changes_without_committing() {
    let repo = TempRepo::init("sample");
    repo.commit_file("a.txt", "one\n", "Initial commit");
    repo.create_branch("topic");
    repo.commit_file("t.txt", "t\n", "Topic work");
    repo.checkout("main");
    let before = repo.head_commit();

    ok(core().merge_branch(repo.path(), "topic", MergeMode::Squash));

    assert_eq!(repo.head_commit(), before);
    assert!(repo.git(&["diff", "--cached", "--name-only"]).contains("t.txt"));
}

#[test]
fn a_merge_that_conflicts_leaves_the_worktree_paused_for_the_banner() {
    let repo = TempRepo::init("sample");
    repo.commit_file("a.txt", "one\n", "Initial commit");
    repo.create_branch("topic");
    repo.commit_file("a.txt", "topic\n", "Topic edit");
    repo.checkout("main");
    repo.commit_file("a.txt", "main\n", "Main edit");

    let outcome = core().merge_branch(repo.path(), "topic", MergeMode::Default).unwrap();

    assert!(matches!(outcome, MutationOutcome::Failed { .. }));
    let paused = core().operation_in_progress(repo.path()).unwrap().expect("paused");
    assert_eq!((paused.kind, paused.conflicts), (OperationKind::Merge, 1));
}

#[test]
fn rebasing_replays_the_current_branch_and_a_conflict_leaves_it_paused() {
    let repo = with_topic();
    repo.checkout("topic");

    ok(core().rebase_onto(repo.path(), "main"));
    assert_eq!(repo.git(&["log", "--format=%s"]).lines().collect::<Vec<_>>(), ["Topic work", "Main work", "Initial commit"]);

    let conflicting = TempRepo::init("conflicting");
    conflicting.commit_file("a.txt", "one\n", "Initial commit");
    conflicting.create_branch("topic");
    conflicting.commit_file("a.txt", "topic\n", "Topic edit");
    conflicting.checkout("main");
    conflicting.commit_file("a.txt", "main\n", "Main edit");
    conflicting.checkout("topic");

    let outcome = core().rebase_onto(conflicting.path(), "main").unwrap();

    assert!(matches!(outcome, MutationOutcome::Failed { .. }));
    assert_eq!(
        core().operation_in_progress(conflicting.path()).unwrap().map(|op| op.kind),
        Some(OperationKind::Rebase)
    );
}
