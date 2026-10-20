use rebasar_core::{
    ConflictFile, ConflictKind, ConflictSegment, ConflictSide, Core, MutationOutcome,
};
use rebasar_testkit::TempRepo;

fn core() -> Core {
    Core::new(|_| {})
}

fn ok(outcome: Result<MutationOutcome, rebasar_core::ApiError>) {
    assert_eq!(outcome.expect("runs"), MutationOutcome::Succeeded);
}

fn conflict(repo: &TempRepo, path: &str) -> ConflictFile {
    core().conflict_file(repo.path(), path).expect("conflict file")
}

fn lf(text: &str) -> String {
    text.replace("\r\n", "\n")
}

/// Both branches rewrite the middle line of `a.txt`; HEAD is on `main`, merging `topic` stops.
fn text_conflict() -> TempRepo {
    let repo = TempRepo::init("sample");
    repo.commit_file("a.txt", "one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\n", "Initial commit");
    repo.create_branch("topic");
    repo.commit_file(
        "a.txt",
        "one\nfrom topic\nthree\nfour\nfive\nsix\nseven\nTOPIC EIGHT\n",
        "Topic edit",
    );
    repo.checkout("main");
    repo.commit_file(
        "a.txt",
        "one\nfrom main\nthree\nfour\nfive\nsix\nseven\nMAIN EIGHT\n",
        "Main edit",
    );
    repo.git_fails(&["merge", "topic"]);
    repo
}

#[test]
fn a_text_conflict_gives_both_sides_and_the_file_cut_at_its_markers() {
    let repo = text_conflict();

    let file = conflict(&repo, "a.txt");

    assert_eq!(file.kind, ConflictKind::Text);
    assert_eq!(lf(&file.ours), "one\nfrom main\nthree\nfour\nfive\nsix\nseven\nMAIN EIGHT\n");
    assert_eq!(lf(&file.theirs), "one\nfrom topic\nthree\nfour\nfive\nsix\nseven\nTOPIC EIGHT\n");
    let segments: Vec<_> = file
        .segments
        .iter()
        .map(|segment| match segment {
            ConflictSegment::Text { text } => ("text", lf(text), String::new()),
            ConflictSegment::Conflict { ours, theirs } => ("conflict", lf(ours), lf(theirs)),
        })
        .collect();
    assert_eq!(
        segments,
        [
            ("text", "one\n".to_owned(), String::new()),
            ("conflict", "from main\n".to_owned(), "from topic\n".to_owned()),
            ("text", "three\nfour\nfive\nsix\nseven\n".to_owned(), String::new()),
            ("conflict", "MAIN EIGHT\n".to_owned(), "TOPIC EIGHT\n".to_owned()),
        ]
    );
}

#[test]
fn the_common_ancestor_section_of_a_diff3_conflict_is_left_out_of_the_segments() {
    let repo = TempRepo::init("sample");
    repo.git(&["config", "merge.conflictStyle", "diff3"]);
    repo.commit_file("a.txt", "one\ntwo\nthree\n", "Initial commit");
    repo.create_branch("topic");
    repo.commit_file("a.txt", "one\ntopic\nthree\n", "Topic edit");
    repo.checkout("main");
    repo.commit_file("a.txt", "one\nmain\nthree\n", "Main edit");
    repo.git_fails(&["merge", "topic"]);

    let file = conflict(&repo, "a.txt");

    assert!(matches!(
        &file.segments[1],
        ConflictSegment::Conflict { ours, theirs } if lf(ours) == "main\n" && lf(theirs) == "topic\n"
    ));
}

#[test]
fn resolving_a_text_conflict_writes_the_result_stages_it_and_lets_the_merge_continue() {
    let repo = text_conflict();

    ok(core().resolve_conflict_file(repo.path(), "a.txt", "one\nboth\nthree\nfour\nfive\n"));

    assert_eq!(repo.git(&["ls-files", "--unmerged"]).trim(), "");
    assert_eq!(lf(&repo.git(&["show", ":a.txt"])), "one\nboth\nthree\nfour\nfive\n");
    ok(core().continue_operation(repo.path()));
    assert!(core().operation_in_progress(repo.path()).unwrap().is_none());
}

#[test]
fn a_file_that_is_not_in_conflict_is_an_error() {
    let repo = text_conflict();

    assert!(core().conflict_file(repo.path(), "missing.txt").is_err());
    assert!(core().conflict_file(repo.path(), "../outside.txt").is_err());
}

#[test]
fn a_file_both_sides_added_is_a_text_conflict() {
    let repo = TempRepo::init("sample");
    repo.commit_file("a.txt", "one\n", "Initial commit");
    repo.create_branch("topic");
    repo.commit_file("new.txt", "topic\n", "Topic adds");
    repo.checkout("main");
    repo.commit_file("new.txt", "main\n", "Main adds");
    repo.git_fails(&["merge", "topic"]);

    let file = conflict(&repo, "new.txt");

    assert_eq!(file.kind, ConflictKind::Text);
    assert!(file.segments.iter().any(|segment| matches!(segment, ConflictSegment::Conflict { .. })));
}

#[test]
fn a_binary_conflict_is_resolved_by_choosing_a_side() {
    let repo = TempRepo::init("sample");
    repo.commit_file("data.bin", "base\n", "Initial commit");
    repo.create_branch("topic");
    repo.write_file("data.bin", b"topic\0bytes".as_slice());
    repo.stage("data.bin");
    repo.git(&["commit", "-m", "Topic binary"]);
    repo.checkout("main");
    repo.write_file("data.bin", b"main\0bytes".as_slice());
    repo.stage("data.bin");
    repo.git(&["commit", "-m", "Main binary"]);
    repo.git_fails(&["merge", "topic"]);
    let file = conflict(&repo, "data.bin");
    assert_eq!(file.kind, ConflictKind::Binary);
    assert!(file.segments.is_empty());

    ok(core().resolve_conflict_with_side(repo.path(), "data.bin", ConflictSide::Theirs));

    assert_eq!(std::fs::read(repo.path().join("data.bin")).unwrap(), b"topic\0bytes");
    assert_eq!(repo.git(&["ls-files", "--unmerged"]).trim(), "");
}

/// `topic` deletes `a.txt` while `main` edits it.
fn delete_modify() -> TempRepo {
    let repo = TempRepo::init("sample");
    repo.commit_file("a.txt", "one\ntwo\n", "Initial commit");
    repo.commit_file("keep.txt", "keep\n", "Keep");
    repo.create_branch("topic");
    repo.git(&["rm", "a.txt"]);
    repo.git(&["commit", "-m", "Topic deletes"]);
    repo.checkout("main");
    repo.commit_file("a.txt", "one\nedited\n", "Main edits");
    repo.git_fails(&["merge", "topic"]);
    repo
}

#[test]
fn a_delete_modify_conflict_says_which_side_deleted_the_file() {
    let repo = delete_modify();

    let file = conflict(&repo, "a.txt");

    assert_eq!(file.kind, ConflictKind::DeleteModify);
    assert_eq!(file.deleted_by, Some(ConflictSide::Theirs));
    assert_eq!(lf(&file.ours), "one\nedited\n");
    assert_eq!(file.theirs, "");
}

#[test]
fn choosing_the_side_that_deleted_the_file_deletes_it() {
    let repo = delete_modify();

    ok(core().resolve_conflict_with_side(repo.path(), "a.txt", ConflictSide::Theirs));

    assert!(!repo.path().join("a.txt").exists());
    assert_eq!(repo.git(&["ls-files", "--unmerged"]).trim(), "");
}

#[test]
fn choosing_the_side_that_kept_the_file_keeps_it() {
    let repo = delete_modify();

    ok(core().resolve_conflict_with_side(repo.path(), "a.txt", ConflictSide::Ours));

    assert_eq!(lf(&std::fs::read_to_string(repo.path().join("a.txt")).unwrap()), "one\nedited\n");
    assert_eq!(repo.git(&["ls-files", "--unmerged"]).trim(), "");
}

#[test]
fn a_rename_conflict_is_not_resolved_here() {
    let repo = TempRepo::init("sample");
    repo.commit_file("a.txt", "one\ntwo\nthree\nfour\nfive\n", "Initial commit");
    repo.create_branch("topic");
    repo.git(&["mv", "a.txt", "topic-name.txt"]);
    repo.git(&["commit", "-m", "Topic renames"]);
    repo.checkout("main");
    repo.git(&["mv", "a.txt", "main-name.txt"]);
    repo.git(&["commit", "-m", "Main renames"]);
    repo.git_fails(&["merge", "topic"]);

    let kinds: Vec<_> = ["main-name.txt", "topic-name.txt"]
        .iter()
        .map(|path| conflict(&repo, path).kind)
        .collect();

    assert_eq!(kinds, [ConflictKind::Unsupported, ConflictKind::Unsupported]);
}

#[test]
fn a_directory_and_file_conflict_is_not_resolved_here() {
    let repo = TempRepo::init("sample");
    repo.commit_file("a.txt", "one\n", "Initial commit");
    repo.create_branch("topic");
    repo.commit_file("thing/inside.txt", "inside\n", "Topic adds a folder");
    repo.checkout("main");
    repo.commit_file("thing", "a file\n", "Main adds a file");
    repo.git_fails(&["merge", "topic"]);
    let unmerged = repo.git(&["ls-files", "--unmerged"]);
    let path = unmerged.lines().next().and_then(|line| line.split('\t').nth(1)).expect("a path").to_owned();

    assert_eq!(conflict(&repo, &path).kind, ConflictKind::Unsupported);
}

#[test]
fn the_file_knows_whether_a_merge_tool_is_configured() {
    let repo = text_conflict();
    assert!(!conflict(&repo, "a.txt").merge_tool_configured);

    repo.git(&["config", "merge.tool", "vimdiff"]);

    assert!(conflict(&repo, "a.txt").merge_tool_configured);
}

#[test]
fn conflicts_of_a_rebase_are_read_the_same_way() {
    let repo = TempRepo::init("sample");
    repo.commit_file("a.txt", "one\ntwo\nthree\n", "Initial commit");
    repo.create_branch("topic");
    repo.commit_file("a.txt", "one\ntopic\nthree\n", "Topic edit");
    repo.checkout("main");
    repo.commit_file("a.txt", "one\nmain\nthree\n", "Main edit");
    repo.checkout("topic");
    repo.git_fails(&["rebase", "main"]);

    let file = conflict(&repo, "a.txt");

    assert_eq!(file.kind, ConflictKind::Text);
    assert_eq!(lf(&file.ours), "one\nmain\nthree\n");
    assert_eq!(lf(&file.theirs), "one\ntopic\nthree\n");

    ok(core().resolve_conflict_file(repo.path(), "a.txt", "one\nmain and topic\nthree\n"));
    ok(core().continue_operation(repo.path()));
    assert!(core().operation_in_progress(repo.path()).unwrap().is_none());
}
