use std::sync::{Arc, Mutex};

use rebasar_core::{
    ApiError, ChangeKind, ChangeList, Core, CoreEvent, DiffContent, DiffLine, DiffRequest,
    LineKind, LineSelection, MutationInfo, MutationOutcome,
};
use rebasar_testkit::TempRepo;

trait Succeeds {
    fn succeeds(self);
}

impl Succeeds for Result<MutationOutcome, ApiError> {
    fn succeeds(self) {
        assert_eq!(self.expect("the mutation runs"), MutationOutcome::Succeeded);
    }
}

fn numbered_lines(count: u32) -> String {
    (1..=count).map(|n| format!("line {n}\n")).collect()
}

fn with_edits(count: u32, edits: &[(u32, &str)]) -> String {
    (1..=count)
        .map(|n| match edits.iter().find(|(line, _)| *line == n) {
            Some((_, text)) => format!("{text}\n"),
            None => format!("line {n}\n"),
        })
        .collect()
}

fn diff_lines(core: &Core, repo: &TempRepo, path: &str, list: ChangeList) -> Vec<Vec<DiffLine>> {
    let diff = core
        .file_diff(
            repo.path(),
            &DiffRequest {
                path: path.to_owned(),
                original_path: None,
                list,
                load_large: false,
                whitespace: Default::default(),
            },
        )
        .expect("file diff");
    match diff.content {
        DiffContent::Text { hunks } => hunks.into_iter().map(|hunk| hunk.lines).collect(),
        other => panic!("expected a text diff, got {other:?}"),
    }
}

fn changed(lines: &[DiffLine]) -> Vec<DiffLine> {
    lines
        .iter()
        .filter(|line| line.kind != LineKind::Context)
        .cloned()
        .collect()
}

fn pick(lines: &[DiffLine], texts: &[&str]) -> Vec<DiffLine> {
    changed(lines)
        .into_iter()
        .filter(|line| texts.contains(&line.text.as_str()))
        .collect()
}

fn selection(path: &str, lines: Vec<DiffLine>) -> LineSelection {
    LineSelection {
        path: path.to_owned(),
        original_path: None,
        lines,
    }
}

fn indexed(repo: &TempRepo, path: &str) -> String {
    repo.git(&["show", &format!(":{path}")])
}

fn repo_with_file(path: &str, contents: &str) -> TempRepo {
    let repo = TempRepo::init("sample");
    repo.commit_file(path, contents, "Initial commit");
    repo
}

#[test]
fn staging_a_hunk_leaves_the_other_hunks_unstaged() {
    let repo = repo_with_file("a.txt", &numbered_lines(30));
    repo.write_file(
        "a.txt",
        with_edits(30, &[(3, "three"), (25, "twenty-five")]),
    );
    let core = Core::new(|_| {});
    let hunks = diff_lines(&core, &repo, "a.txt", ChangeList::Unstaged);
    assert_eq!(hunks.len(), 2);

    core.stage_lines(repo.path(), &selection("a.txt", changed(&hunks[1])))
        .succeeds();

    assert_eq!(
        indexed(&repo, "a.txt"),
        with_edits(30, &[(25, "twenty-five")])
    );
    let remaining = diff_lines(&core, &repo, "a.txt", ChangeList::Unstaged);
    assert_eq!(remaining.len(), 1);
    assert!(pick(&remaining[0], &["three"]).len() == 1);
}

#[test]
fn staging_one_line_of_several_added_lines_stages_only_that_line() {
    let repo = repo_with_file("a.txt", "one\nfour\n");
    repo.write_file("a.txt", "one\ntwo\nthree\nfour\n");
    let core = Core::new(|_| {});
    let hunks = diff_lines(&core, &repo, "a.txt", ChangeList::Unstaged);

    core.stage_lines(
        repo.path(),
        &selection("a.txt", pick(&hunks[0], &["three"])),
    )
    .succeeds();

    assert_eq!(indexed(&repo, "a.txt"), "one\nthree\nfour\n");
}

#[test]
fn staging_one_removed_line_removes_only_that_line_from_the_index() {
    let repo = repo_with_file("a.txt", "one\ntwo\nthree\nfour\n");
    repo.write_file("a.txt", "one\nfour\n");
    let core = Core::new(|_| {});
    let hunks = diff_lines(&core, &repo, "a.txt", ChangeList::Unstaged);

    core.stage_lines(repo.path(), &selection("a.txt", pick(&hunks[0], &["two"])))
        .succeeds();

    assert_eq!(indexed(&repo, "a.txt"), "one\nthree\nfour\n");
}

#[test]
fn staging_only_the_addition_of_a_replaced_line_keeps_the_old_line_beside_it() {
    let repo = repo_with_file("a.txt", "one\ntwo\nthree\n");
    repo.write_file("a.txt", "one\nTWO\nthree\n");
    let core = Core::new(|_| {});
    let hunks = diff_lines(&core, &repo, "a.txt", ChangeList::Unstaged);

    core.stage_lines(repo.path(), &selection("a.txt", pick(&hunks[0], &["TWO"])))
        .succeeds();

    assert_eq!(indexed(&repo, "a.txt"), "one\ntwo\nTWO\nthree\n");
}

#[test]
fn staging_only_the_removal_of_a_replaced_line_leaves_the_new_line_unstaged() {
    let repo = repo_with_file("a.txt", "one\ntwo\nthree\n");
    repo.write_file("a.txt", "one\nTWO\nthree\n");
    let core = Core::new(|_| {});
    let hunks = diff_lines(&core, &repo, "a.txt", ChangeList::Unstaged);

    core.stage_lines(repo.path(), &selection("a.txt", pick(&hunks[0], &["two"])))
        .succeeds();

    assert_eq!(indexed(&repo, "a.txt"), "one\nthree\n");
    let remaining = diff_lines(&core, &repo, "a.txt", ChangeList::Unstaged);
    assert_eq!(
        changed(&remaining[0])
            .iter()
            .map(|line| line.text.as_str())
            .collect::<Vec<_>>(),
        ["TWO"]
    );
}

#[test]
fn staging_the_rest_of_a_partially_staged_file_completes_it() {
    let repo = repo_with_file("a.txt", &numbered_lines(30));
    repo.write_file(
        "a.txt",
        with_edits(30, &[(3, "three"), (25, "twenty-five")]),
    );
    let core = Core::new(|_| {});
    let first = diff_lines(&core, &repo, "a.txt", ChangeList::Unstaged);
    core.stage_lines(repo.path(), &selection("a.txt", changed(&first[0])))
        .succeeds();

    let rest = diff_lines(&core, &repo, "a.txt", ChangeList::Unstaged);
    core.stage_lines(repo.path(), &selection("a.txt", changed(&rest[0])))
        .succeeds();

    assert_eq!(
        indexed(&repo, "a.txt"),
        with_edits(30, &[(3, "three"), (25, "twenty-five")])
    );
    let status = core.worktree_status(repo.path()).expect("status");
    assert!(status.unstaged.is_empty());
}

#[test]
fn unstaging_a_hunk_keeps_the_other_staged_hunks() {
    let repo = repo_with_file("a.txt", &numbered_lines(30));
    let both = with_edits(30, &[(3, "three"), (25, "twenty-five")]);
    repo.write_file("a.txt", &both).stage("a.txt");
    let core = Core::new(|_| {});
    let hunks = diff_lines(&core, &repo, "a.txt", ChangeList::Staged);
    assert_eq!(hunks.len(), 2);

    core.unstage_lines(repo.path(), &selection("a.txt", changed(&hunks[0])))
        .succeeds();

    assert_eq!(
        indexed(&repo, "a.txt"),
        with_edits(30, &[(25, "twenty-five")])
    );
    assert_eq!(
        std::fs::read_to_string(repo.path().join("a.txt")).unwrap(),
        both
    );
}

#[test]
fn unstaging_one_line_of_several_staged_lines_keeps_the_others_staged() {
    let repo = repo_with_file("a.txt", "one\nfour\n");
    repo.write_file("a.txt", "one\ntwo\nthree\nfour\n")
        .stage("a.txt");
    let core = Core::new(|_| {});
    let hunks = diff_lines(&core, &repo, "a.txt", ChangeList::Staged);

    core.unstage_lines(repo.path(), &selection("a.txt", pick(&hunks[0], &["two"])))
        .succeeds();

    assert_eq!(indexed(&repo, "a.txt"), "one\nthree\nfour\n");
}

#[test]
fn unstaging_a_removed_line_puts_it_back_in_the_index() {
    let repo = repo_with_file("a.txt", "one\ntwo\nthree\n");
    repo.write_file("a.txt", "one\nthree\n").stage("a.txt");
    let core = Core::new(|_| {});
    let hunks = diff_lines(&core, &repo, "a.txt", ChangeList::Staged);

    core.unstage_lines(repo.path(), &selection("a.txt", pick(&hunks[0], &["two"])))
        .succeeds();

    assert_eq!(indexed(&repo, "a.txt"), "one\ntwo\nthree\n");
}

#[test]
fn staging_and_unstaging_lines_of_the_same_file_in_turn() {
    let repo = repo_with_file("a.txt", "one\nfour\n");
    repo.write_file("a.txt", "one\ntwo\nthree\nfour\n");
    let core = Core::new(|_| {});
    let unstaged = diff_lines(&core, &repo, "a.txt", ChangeList::Unstaged);
    core.stage_lines(repo.path(), &selection("a.txt", changed(&unstaged[0])))
        .succeeds();

    let staged = diff_lines(&core, &repo, "a.txt", ChangeList::Staged);
    core.unstage_lines(repo.path(), &selection("a.txt", pick(&staged[0], &["two"])))
        .succeeds();

    assert_eq!(indexed(&repo, "a.txt"), "one\nthree\nfour\n");
    let status = core.worktree_status(repo.path()).expect("status");
    assert_eq!(status.unstaged.len(), 1);
    assert_eq!(status.staged.len(), 1);
}

#[test]
fn staging_lines_of_a_new_file_adds_the_file_with_only_those_lines() {
    let repo = repo_with_file("README.md", "readme\n");
    repo.write_file("notes.txt", "alpha\nbeta\ngamma\n");
    let core = Core::new(|_| {});
    let hunks = diff_lines(&core, &repo, "notes.txt", ChangeList::Unstaged);

    core.stage_lines(
        repo.path(),
        &selection("notes.txt", pick(&hunks[0], &["alpha", "gamma"])),
    )
    .succeeds();

    assert_eq!(indexed(&repo, "notes.txt"), "alpha\ngamma\n");
    let status = core.worktree_status(repo.path()).expect("status");
    assert_eq!(status.staged[0].path, "notes.txt");
    assert_eq!(status.staged[0].kind, ChangeKind::Added);
    assert_eq!(status.unstaged[0].path, "notes.txt");
    assert_eq!(status.unstaged[0].kind, ChangeKind::Modified);
}

#[test]
fn unstaging_every_line_of_a_new_file_makes_it_untracked_again() {
    let repo = repo_with_file("README.md", "readme\n");
    repo.write_file("notes.txt", "alpha\nbeta\n")
        .stage("notes.txt");
    let core = Core::new(|_| {});
    let hunks = diff_lines(&core, &repo, "notes.txt", ChangeList::Staged);

    core.unstage_lines(repo.path(), &selection("notes.txt", changed(&hunks[0])))
        .succeeds();

    let status = core.worktree_status(repo.path()).expect("status");
    assert!(status.staged.is_empty());
    assert_eq!(status.unstaged[0].kind, ChangeKind::Untracked);
}

#[test]
fn staging_every_line_of_a_deleted_file_stages_the_deletion() {
    let repo = repo_with_file("a.txt", "one\ntwo\n");
    repo.delete_file("a.txt");
    let core = Core::new(|_| {});
    let hunks = diff_lines(&core, &repo, "a.txt", ChangeList::Unstaged);

    core.stage_lines(repo.path(), &selection("a.txt", changed(&hunks[0])))
        .succeeds();

    let status = core.worktree_status(repo.path()).expect("status");
    assert_eq!(status.staged[0].kind, ChangeKind::Deleted);
    assert!(status.unstaged.is_empty());
}

#[test]
fn staging_one_line_of_a_deleted_file_keeps_the_rest_in_the_index() {
    let repo = repo_with_file("a.txt", "one\ntwo\n");
    repo.delete_file("a.txt");
    let core = Core::new(|_| {});
    let hunks = diff_lines(&core, &repo, "a.txt", ChangeList::Unstaged);

    core.stage_lines(repo.path(), &selection("a.txt", pick(&hunks[0], &["one"])))
        .succeeds();

    assert_eq!(indexed(&repo, "a.txt"), "two\n");
}

#[test]
fn unstaging_lines_of_a_staged_deletion_restores_them_to_the_index() {
    let repo = repo_with_file("a.txt", "one\ntwo\n");
    repo.delete_file("a.txt").stage("a.txt");
    let core = Core::new(|_| {});
    let hunks = diff_lines(&core, &repo, "a.txt", ChangeList::Staged);

    core.unstage_lines(repo.path(), &selection("a.txt", pick(&hunks[0], &["two"])))
        .succeeds();

    assert_eq!(indexed(&repo, "a.txt"), "two\n");
}

#[test]
fn a_file_without_a_final_newline_can_be_staged_line_by_line() {
    let repo = repo_with_file("a.txt", "one\ntwo");
    repo.write_file("a.txt", "ONE\ntwo\nthree");
    let core = Core::new(|_| {});
    let hunks = diff_lines(&core, &repo, "a.txt", ChangeList::Unstaged);

    core.stage_lines(repo.path(), &selection("a.txt", pick(&hunks[0], &["ONE"])))
        .succeeds();

    assert_eq!(indexed(&repo, "a.txt"), "one\ntwo\nONE\n");
}

#[test]
fn staging_a_line_of_a_crlf_working_copy_keeps_the_index_on_lf() {
    let repo = repo_with_file("a.txt", "one\ntwo\nthree\n");
    repo.write_file("a.txt", "one\r\ntwo\r\nTHREE\r\nfour\r\n");
    let core = Core::new(|_| {});
    let hunks = diff_lines(&core, &repo, "a.txt", ChangeList::Unstaged);

    core.stage_lines(repo.path(), &selection("a.txt", pick(&hunks[0], &["four"])))
        .succeeds();

    assert_eq!(indexed(&repo, "a.txt"), "one\ntwo\nthree\nfour\n");
}

#[test]
fn staging_lines_of_a_file_that_changed_since_the_diff_fails_and_leaves_the_index_alone() {
    let repo = repo_with_file("a.txt", "one\ntwo\n");
    repo.write_file("a.txt", "one\nTWO\n");
    let core = Core::new(|_| {});
    let hunks = diff_lines(&core, &repo, "a.txt", ChangeList::Unstaged);
    repo.write_file("a.txt", "one\nSOMETHING ELSE\n");

    let result = core.stage_lines(repo.path(), &selection("a.txt", changed(&hunks[0])));

    assert!(matches!(result, Err(ApiError::Unexpected { .. })));
    assert_eq!(indexed(&repo, "a.txt"), "one\ntwo\n");
}

#[test]
fn a_context_line_cannot_be_selected() {
    let repo = repo_with_file("a.txt", "one\ntwo\nthree\n");
    repo.write_file("a.txt", "one\nTWO\nthree\n");
    let core = Core::new(|_| {});
    let hunks = diff_lines(&core, &repo, "a.txt", ChangeList::Unstaged);
    let context: Vec<DiffLine> = hunks[0]
        .iter()
        .filter(|line| line.kind == LineKind::Context)
        .cloned()
        .collect();

    let result = core.stage_lines(repo.path(), &selection("a.txt", context));

    assert!(matches!(result, Err(ApiError::Unexpected { .. })));
}

#[test]
fn a_binary_file_has_no_lines_to_stage() {
    let repo = repo_with_file("README.md", "readme\n");
    repo.write_file("logo.bin", [0u8, 1, 2, 3]);
    let core = Core::new(|_| {});
    let line = DiffLine {
        kind: LineKind::Added,
        old_number: None,
        new_number: Some(1),
        text: String::new(),
    };

    let result = core.stage_lines(repo.path(), &selection("logo.bin", vec![line]));

    assert!(matches!(result, Err(ApiError::Unexpected { .. })));
}

#[test]
fn a_file_name_with_spaces_and_accents_can_be_staged_line_by_line() {
    let name = "my notes/résumé.txt";
    let repo = repo_with_file("README.md", "readme\n");
    repo.write_file(name, "one\ntwo\n");
    let core = Core::new(|_| {});
    let hunks = diff_lines(&core, &repo, name, ChangeList::Unstaged);

    core.stage_lines(repo.path(), &selection(name, pick(&hunks[0], &["two"])))
        .succeeds();

    assert_eq!(indexed(&repo, name), "two\n");
}

#[test]
fn staging_lines_is_reported_as_a_mutation_naming_the_file() {
    let events = Arc::new(Mutex::new(Vec::new()));
    let sink = Arc::clone(&events);
    let core = Core::new(move |event| sink.lock().unwrap().push(event));
    let repo = repo_with_file("a.txt", "one\n");
    repo.write_file("a.txt", "one\ntwo\nthree\n");
    let hunks = diff_lines(&core, &repo, "a.txt", ChangeList::Unstaged);

    core.stage_lines(repo.path(), &selection("a.txt", changed(&hunks[0])))
        .succeeds();

    let titles: Vec<String> = events
        .lock()
        .unwrap()
        .iter()
        .filter_map(|event| match event {
            CoreEvent::MutationQueued {
                mutation: MutationInfo { title, .. },
            } => Some(title.clone()),
            _ => None,
        })
        .collect();
    assert_eq!(titles, ["Stage 2 lines of a.txt"]);
}
