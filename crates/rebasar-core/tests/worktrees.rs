use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use rebasar_core::{
    Assessment, Core, CoreEvent, Head, MutationKind, MutationOutcome, WorktreeStart,
};
use rebasar_testkit::{TempRepo, Workspace};

fn core() -> Core {
    Core::new(|_| {})
}

fn ok(outcome: Result<MutationOutcome, rebasar_core::ApiError>) {
    assert_eq!(outcome.expect("runs"), MutationOutcome::Succeeded);
}

fn repo() -> TempRepo {
    let repo = TempRepo::init("sample");
    repo.commit_file("a.txt", "one\n", "Initial commit");
    repo.create_branch("topic");
    repo.checkout("main");
    repo
}

fn target(workspace: &Workspace, name: &str) -> PathBuf {
    workspace.path().join(name)
}

#[test]
fn the_main_worktree_is_listed_alone_at_first() {
    let repo = repo();

    let list = core().list_worktree_details(repo.path()).unwrap();

    assert_eq!(list.len(), 1);
    assert!(list[0].main && list[0].current && !list[0].dirty);
    assert_eq!(list[0].head, Head::Branch { name: "main".to_owned() });
}

#[test]
fn a_created_worktree_checks_out_the_chosen_branch() {
    let repo = repo();
    let workspace = Workspace::new();
    let folder = target(&workspace, "topic-tree");

    ok(core().create_worktree(repo.path(), &folder, &WorktreeStart::Branch { name: "topic".into() }, None));

    let list = core().list_worktree_details(repo.path()).unwrap();
    assert_eq!(list.len(), 2);
    assert!(!list[1].main && !list[1].current);
    assert_eq!(list[1].head, Head::Branch { name: "topic".to_owned() });
    assert!(folder.join("a.txt").exists());
}

#[test]
fn a_new_branch_can_be_started_from_a_branch_or_a_commit() {
    let repo = repo();
    let workspace = Workspace::new();
    let head = repo.head_commit();

    ok(core().create_worktree(
        repo.path(),
        &target(&workspace, "from-branch"),
        &WorktreeStart::Branch { name: "main".into() },
        Some("feature-a"),
    ));
    ok(core().create_worktree(
        repo.path(),
        &target(&workspace, "from-commit"),
        &WorktreeStart::Commit { id: head[..10].to_owned() },
        Some("feature-b"),
    ));

    let heads: Vec<_> = core().list_worktree_details(repo.path()).unwrap().into_iter().map(|w| w.head).collect();
    assert!(heads.contains(&Head::Branch { name: "feature-a".to_owned() }));
    assert!(heads.contains(&Head::Branch { name: "feature-b".to_owned() }));
}

#[test]
fn a_worktree_started_from_a_commit_alone_is_detached() {
    let repo = repo();
    let workspace = Workspace::new();

    ok(core().create_worktree(
        repo.path(),
        &target(&workspace, "detached"),
        &WorktreeStart::Commit { id: repo.head_commit() },
        None,
    ));

    let list = core().list_worktree_details(repo.path()).unwrap();
    assert!(matches!(list[1].head, Head::Detached { .. }));
}

#[test]
fn a_branch_checked_out_elsewhere_or_a_bad_start_fails_without_adding_anything() {
    let repo = repo();
    let workspace = Workspace::new();

    let outcome = core()
        .create_worktree(repo.path(), &target(&workspace, "again"), &WorktreeStart::Branch { name: "main".into() }, None)
        .unwrap();
    assert!(matches!(outcome, MutationOutcome::Failed { .. }));
    assert!(core()
        .create_worktree(repo.path(), &target(&workspace, "bad"), &WorktreeStart::Commit { id: "not-a-commit".into() }, None)
        .is_err());
    assert!(core()
        .create_worktree(repo.path(), &target(&workspace, "dash"), &WorktreeStart::Branch { name: "-x".into() }, None)
        .is_err());
    assert_eq!(core().list_worktree_details(repo.path()).unwrap().len(), 1);
}

#[test]
fn a_worktree_with_uncommitted_work_is_dirty_and_removing_it_names_that_work() {
    let repo = repo();
    let workspace = Workspace::new();
    let folder = target(&workspace, "topic-tree");
    ok(core().create_worktree(repo.path(), &folder, &WorktreeStart::Branch { name: "topic".into() }, None));
    let clean = MutationKind::RemoveWorktree { path: folder.to_string_lossy().into_owned() };
    assert_eq!(core().assess_mutation(repo.path(), &clean).unwrap(), Assessment::Safe);

    std::fs::write(folder.join("a.txt"), "edited\n").unwrap();
    std::fs::write(folder.join("new.txt"), "new\n").unwrap();

    let list = core().list_worktree_details(repo.path()).unwrap();
    assert!(list[1].dirty);
    let Assessment::Destructive { loss } = core().assess_mutation(repo.path(), &clean).unwrap() else {
        panic!("uncommitted work is lost");
    };
    let mut paths: Vec<_> = loss.files.iter().map(|f| f.path.as_str()).collect();
    paths.sort();
    assert_eq!(paths, ["a.txt", "new.txt"]);
}

#[test]
fn removing_a_clean_worktree_deletes_its_folder_and_closes_its_tab() {
    let events = Arc::new(Mutex::new(Vec::new()));
    let sink = Arc::clone(&events);
    let core = Core::new(move |event| sink.lock().unwrap().push(event));
    let repo = repo();
    let workspace = Workspace::new();
    let folder = target(&workspace, "topic-tree");
    ok(core.create_worktree(repo.path(), &folder, &WorktreeStart::Branch { name: "topic".into() }, None));
    core.open_folder(&folder).unwrap();

    ok(core.remove_worktree(repo.path(), &folder, false));

    assert!(!folder.exists());
    assert_eq!(core.list_worktree_details(repo.path()).unwrap().len(), 1);
    assert!(events.lock().unwrap().iter().any(|event| matches!(event, CoreEvent::TabClosed { .. })));
}

#[test]
fn removing_a_dirty_worktree_needs_force() {
    let repo = repo();
    let workspace = Workspace::new();
    let folder = target(&workspace, "topic-tree");
    ok(core().create_worktree(repo.path(), &folder, &WorktreeStart::Branch { name: "topic".into() }, None));
    std::fs::write(folder.join("a.txt"), "edited\n").unwrap();

    let refused = core().remove_worktree(repo.path(), &folder, false).unwrap();
    assert!(matches!(refused, MutationOutcome::Failed { .. }));
    assert!(folder.exists());

    ok(core().remove_worktree(repo.path(), &folder, true));
    assert!(!folder.exists());
}

#[test]
fn the_main_worktree_cannot_be_removed() {
    let repo = repo();

    let outcome = core().remove_worktree(repo.path(), repo.path(), true).unwrap();

    assert!(matches!(outcome, MutationOutcome::Failed { .. }));
    assert!(repo.path().exists());
}

#[test]
fn pruning_forgets_a_worktree_whose_folder_was_deleted() {
    let repo = repo();
    let workspace = Workspace::new();
    let folder = target(&workspace, "topic-tree");
    ok(core().create_worktree(repo.path(), &folder, &WorktreeStart::Branch { name: "topic".into() }, None));
    std::fs::remove_dir_all(&folder).unwrap();

    ok(core().prune_worktrees(repo.path()));

    assert!(repo.git(&["worktree", "list", "--porcelain"]).lines().filter(|l| l.starts_with("worktree ")).count() == 1);
}
