use rebasar_core::{
    Core, MutationOutcome, OperationKind, PlanAction, RebasePlan, RebasePlanEntry,
};
use rebasar_testkit::TempRepo;

fn core() -> Core {
    Core::new(|_| {})
}

/// Four commits on `main`: Base, then A, B and C.
fn history() -> TempRepo {
    let repo = TempRepo::init("sample");
    repo.commit_file("base.txt", "base\n", "Base");
    repo.commit_file("a.txt", "a\n", "A");
    repo.commit_file("b.txt", "b\n", "B");
    repo.commit_file("c.txt", "c\n", "C");
    repo
}

fn id_of(repo: &TempRepo, revision: &str) -> String {
    repo.git(&["rev-parse", revision]).trim().to_owned()
}

fn plan_from(repo: &TempRepo, revision: &str) -> RebasePlan {
    core()
        .rebase_plan(repo.path(), Some(&id_of(repo, revision)))
        .expect("plan")
}

fn subjects(repo: &TempRepo) -> Vec<String> {
    repo.git(&["log", "--format=%s"]).lines().map(str::to_owned).collect()
}

fn set_action(plan: &mut RebasePlan, subject: &str, new_action: PlanAction) {
    for entry in &mut plan.entries {
        if let RebasePlanEntry::Commit { action, subject: found, .. } = entry {
            if found == subject {
                *action = new_action;
            }
        }
    }
}

fn apply(repo: &TempRepo, plan: &RebasePlan) -> MutationOutcome {
    core().apply_rebase_plan(repo.path(), plan).expect("apply")
}

#[test]
fn the_plan_lists_the_commits_from_the_chosen_one_to_the_tip_oldest_first() {
    let repo = history();

    let plan = plan_from(&repo, "HEAD~1");

    let listed: Vec<_> = plan
        .entries
        .iter()
        .map(|entry| match entry {
            RebasePlanEntry::Commit { action, subject, .. } => (*action, subject.as_str()),
            RebasePlanEntry::Line { .. } => panic!("no lines in a new plan"),
        })
        .collect();
    assert_eq!(listed, [(PlanAction::Pick, "B"), (PlanAction::Pick, "C")]);
    assert_eq!(plan.onto, Some(id_of(&repo, "HEAD~2")));
    assert!(!plan.in_progress);
}

#[test]
fn the_first_commit_of_a_history_is_planned_from_its_root() {
    let repo = history();

    let plan = plan_from(&repo, "HEAD~3");

    assert_eq!(plan.onto, None);
    assert_eq!(plan.entries.len(), 4);
}

#[test]
fn a_commit_that_is_not_on_the_branch_is_refused() {
    let repo = history();
    repo.create_branch("other");
    repo.commit_file("o.txt", "o\n", "Other");
    let other = id_of(&repo, "HEAD");
    repo.checkout("main");

    assert!(core().rebase_plan(repo.path(), Some(&other)).is_err());
    assert!(core().rebase_plan(repo.path(), Some("main")).is_err());
}

#[test]
fn merge_commits_are_left_out_of_the_plan_as_git_leaves_them_out_of_the_todo_list() {
    let repo = TempRepo::init("sample");
    repo.commit_file("a.txt", "a\n", "A");
    repo.create_branch("topic");
    repo.commit_file("t.txt", "t\n", "Topic");
    repo.checkout("main");
    repo.commit_file("m.txt", "m\n", "Main");
    repo.git(&["merge", "--no-ff", "-m", "Merge topic", "topic"]);

    let plan = plan_from(&repo, "HEAD~2");

    let names: Vec<_> = plan
        .entries
        .iter()
        .filter_map(|entry| match entry {
            RebasePlanEntry::Commit { subject, .. } => Some(subject.as_str()),
            RebasePlanEntry::Line { .. } => None,
        })
        .collect();
    assert!(!names.contains(&"Merge topic"));
}

#[test]
fn an_unchanged_plan_changes_nothing_visible() {
    let repo = history();
    let plan = plan_from(&repo, "HEAD~1");

    assert_eq!(apply(&repo, &plan), MutationOutcome::Succeeded);

    assert_eq!(subjects(&repo), ["C", "B", "A", "Base"]);
}

#[test]
fn drop_removes_the_commit() {
    let repo = history();
    let mut plan = plan_from(&repo, "HEAD~2");
    set_action(&mut plan, "B", PlanAction::Drop);

    assert_eq!(apply(&repo, &plan), MutationOutcome::Succeeded);

    assert_eq!(subjects(&repo), ["C", "A", "Base"]);
    assert!(!repo.path().join("b.txt").exists());
}

#[test]
fn squash_folds_a_commit_into_the_one_before_it() {
    let repo = history();
    let mut plan = plan_from(&repo, "HEAD~1");
    set_action(&mut plan, "C", PlanAction::Squash);

    assert_eq!(apply(&repo, &plan), MutationOutcome::Succeeded);

    assert_eq!(subjects(&repo).len(), 3);
    assert!(repo.path().join("b.txt").exists() && repo.path().join("c.txt").exists());
    assert!(repo.git(&["log", "-1", "--format=%B"]).contains("C"));
}

#[test]
fn fixup_folds_a_commit_in_and_keeps_only_the_earlier_message() {
    let repo = history();
    let mut plan = plan_from(&repo, "HEAD~1");
    set_action(&mut plan, "C", PlanAction::Fixup);

    assert_eq!(apply(&repo, &plan), MutationOutcome::Succeeded);

    assert_eq!(subjects(&repo), ["B", "A", "Base"]);
    assert!(repo.path().join("c.txt").exists());
}

#[test]
fn reordering_replays_the_commits_in_the_new_order() {
    let repo = history();
    let mut plan = plan_from(&repo, "HEAD~1");
    plan.entries.reverse();

    assert_eq!(apply(&repo, &plan), MutationOutcome::Succeeded);

    assert_eq!(subjects(&repo), ["B", "C", "A", "Base"]);
}

#[test]
fn reword_replaces_the_message_and_keeps_the_content() {
    let repo = history();
    let mut plan = plan_from(&repo, "HEAD~1");
    for entry in &mut plan.entries {
        if let RebasePlanEntry::Commit { action, subject, message, .. } = entry {
            if subject == "B" {
                *action = PlanAction::Reword;
                *message = "B, but better worded\n\nWith a body.".to_owned();
            }
        }
    }

    assert_eq!(apply(&repo, &plan), MutationOutcome::Succeeded);

    assert_eq!(subjects(&repo), ["C", "B, but better worded", "A", "Base"]);
    assert!(repo.git(&["log", "-2", "--format=%B"]).contains("With a body."));
    assert!(repo.path().join("b.txt").exists());
}

#[test]
fn a_message_with_quotes_and_dollar_signs_is_kept_as_typed() {
    let repo = history();
    let mut plan = plan_from(&repo, "HEAD");
    if let RebasePlanEntry::Commit { action, message, .. } = &mut plan.entries[0] {
        *action = PlanAction::Reword;
        *message = "Say \"hi\" to $HOME and 'you' `now`".to_owned();
    }

    assert_eq!(apply(&repo, &plan), MutationOutcome::Succeeded);

    assert_eq!(subjects(&repo)[0], "Say \"hi\" to $HOME and 'you' `now`");
}

#[test]
fn the_rebase_runs_in_a_folder_whose_name_has_spaces() {
    let repo = TempRepo::init("a folder with spaces");
    repo.commit_file("a.txt", "a\n", "A");
    repo.commit_file("b.txt", "b\n", "B");
    let mut plan = plan_from(&repo, "HEAD");
    set_action(&mut plan, "B", PlanAction::Drop);

    assert_eq!(apply(&repo, &plan), MutationOutcome::Succeeded);

    assert_eq!(subjects(&repo), ["A"]);
}

#[test]
fn a_plan_that_conflicts_stops_for_the_banner_and_the_conflicts_view() {
    let repo = TempRepo::init("sample");
    repo.commit_file("a.txt", "one\n", "Base");
    repo.commit_file("a.txt", "two\n", "Edit one");
    repo.commit_file("a.txt", "three\n", "Edit two");
    let mut plan = plan_from(&repo, "HEAD~1");
    plan.entries.reverse();

    let outcome = apply(&repo, &plan);

    assert!(matches!(outcome, MutationOutcome::Failed { .. }));
    let paused = core().operation_in_progress(repo.path()).unwrap().expect("paused");
    assert_eq!(paused.kind, OperationKind::Rebase);
    assert!(paused.conflicts > 0);
}

#[test]
fn a_paused_rebase_gives_its_remaining_steps_with_exec_and_edit_entries_kept_as_they_are() {
    let repo = TempRepo::init("sample");
    repo.commit_file("a.txt", "one\n", "Base");
    repo.commit_file("b.txt", "b\n", "B");
    repo.commit_file("c.txt", "c\n", "C");
    repo.commit_file("d.txt", "d\n", "D");
    let b = id_of(&repo, "HEAD~2");
    let c = id_of(&repo, "HEAD~1");
    let d = id_of(&repo, "HEAD");
    let todo = format!("break\nexec echo hello\nedit {c}\npick {d}\n");
    let todo_file = repo.path().join("todo.txt");
    std::fs::write(&todo_file, todo).unwrap();
    let editor = format!("cp '{}'", todo_file.to_string_lossy().replace('\\', "/"));
    let status = std::process::Command::new("git")
        .args(["rebase", "--interactive", &format!("{b}^")])
        .env("GIT_SEQUENCE_EDITOR", editor)
        .env("GIT_EDITOR", "true")
        .current_dir(repo.path())
        .status()
        .unwrap();
    assert!(status.success(), "the rebase pauses at the break");

    let plan = core().rebase_plan(repo.path(), None).unwrap();

    assert!(plan.in_progress);
    assert!(matches!(&plan.entries[0], RebasePlanEntry::Line { text } if text.starts_with("exec")));
    assert!(matches!(
        &plan.entries[1],
        RebasePlanEntry::Commit { action: PlanAction::Edit, subject, .. } if subject == "C"
    ));
    assert!(matches!(
        &plan.entries[2],
        RebasePlanEntry::Commit { action: PlanAction::Pick, subject, .. } if subject == "D"
    ));
}

#[test]
fn applying_an_edited_plan_to_a_rebase_in_progress_keeps_the_read_only_entries() {
    let repo = TempRepo::init("sample");
    repo.commit_file("a.txt", "one\n", "Base");
    repo.commit_file("b.txt", "b\n", "B");
    repo.commit_file("c.txt", "c\n", "C");
    repo.commit_file("d.txt", "d\n", "D");
    let b = id_of(&repo, "HEAD~2");
    let c = id_of(&repo, "HEAD~1");
    let d = id_of(&repo, "HEAD");
    let todo_file = repo.path().join("todo.txt");
    std::fs::write(&todo_file, format!("break\nexec echo hello\npick {c}\npick {d}\n")).unwrap();
    let editor = format!("cp '{}'", todo_file.to_string_lossy().replace('\\', "/"));
    std::process::Command::new("git")
        .args(["rebase", "--interactive", &format!("{b}^")])
        .env("GIT_SEQUENCE_EDITOR", editor)
        .env("GIT_EDITOR", "true")
        .current_dir(repo.path())
        .status()
        .unwrap();
    let mut plan = core().rebase_plan(repo.path(), None).unwrap();
    set_action(&mut plan, "D", PlanAction::Drop);

    assert_eq!(apply(&repo, &plan), MutationOutcome::Succeeded);
    let paused = core().operation_in_progress(repo.path()).unwrap();
    assert!(paused.is_some(), "still paused at the break");
    let remaining = core().rebase_plan(repo.path(), None).unwrap();
    assert!(remaining.entries.iter().any(|entry| matches!(entry, RebasePlanEntry::Line { text } if text.starts_with("exec"))));
    assert!(remaining.entries.iter().any(|entry| matches!(entry, RebasePlanEntry::Commit { action: PlanAction::Drop, subject, .. } if subject == "D")));
}

#[test]
fn a_plan_with_something_that_is_not_a_commit_id_is_refused() {
    let repo = history();
    let mut plan = plan_from(&repo, "HEAD");
    if let RebasePlanEntry::Commit { commit, .. } = &mut plan.entries[0] {
        *commit = "--exec=evil".to_owned();
    }

    assert!(core().apply_rebase_plan(repo.path(), &plan).is_err());
}
