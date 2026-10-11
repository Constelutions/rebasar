use rebasar_core::{
    ApiError, ChangeKind, CommitDetail, CommitDiffRequest, Core, DiffContent, FileChange, FileDiff,
};
use rebasar_testkit::TempRepo;

fn detail(repo: &TempRepo, commit: &str, parent: usize) -> CommitDetail {
    Core::new(|_| {})
        .commit_detail(repo.path(), commit, parent)
        .expect("commit detail")
}

fn rev(repo: &TempRepo, revision: &str) -> String {
    repo.git(&["rev-parse", revision]).trim().to_owned()
}

fn file<'a>(detail: &'a CommitDetail, path: &str) -> &'a FileChange {
    detail
        .files
        .iter()
        .find(|file| file.path == path)
        .unwrap_or_else(|| panic!("no file `{path}` in {:?}", detail.files))
}

fn diff_request(commit: &str, parent: usize, path: &str) -> CommitDiffRequest {
    CommitDiffRequest {
        commit: commit.to_owned(),
        parent,
        path: path.to_owned(),
        original_path: None,
        load_large: false,
    }
}

fn diff_of(repo: &TempRepo, request: &CommitDiffRequest) -> FileDiff {
    Core::new(|_| {})
        .commit_file_diff(repo.path(), request)
        .expect("commit file diff")
}

fn added_lines(diff: &FileDiff) -> Vec<String> {
    let DiffContent::Text { hunks } = &diff.content else {
        panic!("expected a text diff, got {:?}", diff.content);
    };
    hunks
        .iter()
        .flat_map(|hunk| &hunk.lines)
        .filter(|line| line.kind == rebasar_core::LineKind::Added)
        .map(|line| line.text.clone())
        .collect()
}

#[test]
fn a_commit_reports_its_author_date_full_message_and_parent() {
    let repo = TempRepo::init("sample");
    repo.commit_file("a.txt", "one\n", "First");
    repo.write_file("a.txt", "one\ntwo\n").stage("a.txt");
    repo.git(&["commit", "--message", "Second", "--message", "More detail."]);

    let commit = rev(&repo, "HEAD");
    let detail = detail(&repo, &commit, 0);

    assert_eq!(detail.id, commit);
    assert_eq!(detail.short_id, commit[..7]);
    assert_eq!(detail.author_name, "Test Author");
    assert_eq!(detail.author_email, "author@example.com");
    assert_eq!(detail.author_timestamp, 1_700_000_060);
    assert_eq!(detail.message, "Second\n\nMore detail.");
    assert_eq!(detail.parents.len(), 1);
    assert_eq!(detail.parents[0].id, rev(&repo, "HEAD~1"));
    assert_eq!(detail.parents[0].subject, "First");
}

#[test]
fn a_commit_lists_its_changed_files_with_status_and_line_counts() {
    let repo = TempRepo::init("sample");
    repo.commit_file("keep.txt", "a\nb\nc\n", "First");
    repo.write_file("keep.txt", "a\nB\nc\nd\n")
        .write_file("new.txt", "x\ny\n")
        .write_file("src/deep.txt", "z\n");
    repo.git(&["add", "--all"]);
    repo.git(&["commit", "--message", "Second"]);

    let detail = detail(&repo, &rev(&repo, "HEAD"), 0);

    assert_eq!(
        detail
            .files
            .iter()
            .map(|file| file.path.as_str())
            .collect::<Vec<_>>(),
        ["keep.txt", "new.txt", "src/deep.txt"]
    );
    let keep = file(&detail, "keep.txt");
    assert_eq!(keep.kind, ChangeKind::Modified);
    assert_eq!((keep.added, keep.removed), (Some(2), Some(1)));
    let new = file(&detail, "new.txt");
    assert_eq!(new.kind, ChangeKind::Added);
    assert_eq!((new.added, new.removed), (Some(2), Some(0)));
}

#[test]
fn a_deleted_file_counts_the_lines_it_lost() {
    let repo = TempRepo::init("sample");
    repo.commit_file("gone.txt", "a\nb\n", "First");
    repo.delete_file("gone.txt").stage("gone.txt");
    repo.git(&["commit", "--message", "Second"]);

    let detail = detail(&repo, &rev(&repo, "HEAD"), 0);

    let gone = file(&detail, "gone.txt");
    assert_eq!(gone.kind, ChangeKind::Deleted);
    assert_eq!((gone.added, gone.removed), (Some(0), Some(2)));
}

#[test]
fn a_binary_file_has_no_line_counts() {
    let repo = TempRepo::init("sample");
    repo.write_file("logo.bin", [0u8, 1, 2, 3])
        .stage("logo.bin");
    repo.git(&["commit", "--message", "Add logo"]);

    let detail = detail(&repo, &rev(&repo, "HEAD"), 0);

    let logo = file(&detail, "logo.bin");
    assert_eq!((logo.added, logo.removed), (None, None));
}

#[test]
fn the_root_commit_has_no_parents_and_lists_every_file_as_added() {
    let repo = TempRepo::init("sample");
    repo.commit_file("a.txt", "one\n", "Root");

    let detail = detail(&repo, &rev(&repo, "HEAD"), 0);

    assert!(detail.parents.is_empty());
    assert_eq!(file(&detail, "a.txt").kind, ChangeKind::Added);
}

#[test]
fn a_renamed_file_names_where_it_came_from() {
    let repo = TempRepo::init("sample");
    repo.commit_file("old.txt", "one\ntwo\nthree\nfour\n", "First");
    repo.git(&["mv", "old.txt", "new.txt"]);
    repo.write_file("new.txt", "one\ntwo\nthree\nfour\nfive\n")
        .stage("new.txt");
    repo.git(&["commit", "--message", "Rename"]);

    let detail = detail(&repo, &rev(&repo, "HEAD"), 0);

    assert_eq!(detail.files.len(), 1);
    let renamed = &detail.files[0];
    assert_eq!(renamed.kind, ChangeKind::Renamed);
    assert_eq!(renamed.path, "new.txt");
    assert_eq!(renamed.original_path.as_deref(), Some("old.txt"));
    assert_eq!((renamed.added, renamed.removed), (Some(1), Some(0)));
}

/// main: A - M, side: A - S, with M merging side. A has a.txt; S adds s.txt; main adds m.txt.
fn merge_repo() -> TempRepo {
    let repo = TempRepo::init("sample");
    repo.commit_file("a.txt", "a\n", "A")
        .create_branch("side")
        .commit_file("s.txt", "s\n", "S")
        .checkout("main")
        .commit_file("m.txt", "m\n", "Main")
        .merge("side");
    repo
}

#[test]
fn a_merge_commit_lists_both_parents_and_diffs_against_the_first_by_default() {
    let repo = merge_repo();

    let detail = detail(&repo, &rev(&repo, "HEAD"), 0);

    assert_eq!(
        detail
            .parents
            .iter()
            .map(|parent| parent.subject.as_str())
            .collect::<Vec<_>>(),
        ["Main", "S"]
    );
    assert_eq!(
        detail
            .files
            .iter()
            .map(|file| file.path.as_str())
            .collect::<Vec<_>>(),
        ["s.txt"]
    );
}

#[test]
fn a_merge_commit_can_be_diffed_against_another_parent() {
    let repo = merge_repo();

    let detail = detail(&repo, &rev(&repo, "HEAD"), 1);

    assert_eq!(
        detail
            .files
            .iter()
            .map(|file| file.path.as_str())
            .collect::<Vec<_>>(),
        ["m.txt"]
    );
}

#[test]
fn asking_for_a_parent_the_commit_does_not_have_is_an_error() {
    let repo = merge_repo();

    let result = Core::new(|_| {}).commit_detail(repo.path(), &rev(&repo, "HEAD"), 2);

    assert!(matches!(result, Err(ApiError::Unexpected { .. })));
}

#[test]
fn a_commit_that_does_not_exist_is_an_error() {
    let repo = TempRepo::init("sample");
    repo.commit_file("a.txt", "a\n", "A");

    let result = Core::new(|_| {}).commit_detail(repo.path(), &"0".repeat(40), 0);

    assert!(matches!(result, Err(ApiError::Unexpected { .. })));
}

#[test]
fn a_file_diff_shows_the_lines_the_commit_changed() {
    let repo = TempRepo::init("sample");
    repo.commit_file("a.txt", "one\n", "First");
    repo.commit_file("a.txt", "one\ntwo\n", "Second");

    let diff = diff_of(&repo, &diff_request(&rev(&repo, "HEAD"), 0, "a.txt"));

    assert_eq!(added_lines(&diff), ["two"]);
}

#[test]
fn a_root_commit_file_diff_adds_every_line() {
    let repo = TempRepo::init("sample");
    repo.commit_file("a.txt", "one\ntwo\n", "Root");

    let diff = diff_of(&repo, &diff_request(&rev(&repo, "HEAD"), 0, "a.txt"));

    assert_eq!(added_lines(&diff), ["one", "two"]);
}

#[test]
fn a_merge_file_diff_is_taken_against_the_chosen_parent() {
    let repo = merge_repo();
    let merge = rev(&repo, "HEAD");

    let against_first = diff_of(&repo, &diff_request(&merge, 0, "s.txt"));
    let against_second = diff_of(&repo, &diff_request(&merge, 1, "m.txt"));

    assert_eq!(added_lines(&against_first), ["s"]);
    assert_eq!(added_lines(&against_second), ["m"]);
}

#[test]
fn a_renamed_file_diff_compares_against_the_original_path() {
    let repo = TempRepo::init("sample");
    repo.commit_file("old.txt", "one\ntwo\nthree\nfour\n", "First");
    repo.git(&["mv", "old.txt", "new.txt"]);
    repo.write_file("new.txt", "one\ntwo\nthree\nfour\nfive\n")
        .stage("new.txt");
    repo.git(&["commit", "--message", "Rename"]);
    let mut request = diff_request(&rev(&repo, "HEAD"), 0, "new.txt");
    request.original_path = Some("old.txt".to_owned());

    let diff = diff_of(&repo, &request);

    assert_eq!(diff.original_path.as_deref(), Some("old.txt"));
    assert_eq!(added_lines(&diff), ["five"]);
}

#[test]
fn a_huge_file_in_a_commit_is_collapsed_until_it_is_asked_for() {
    let repo = TempRepo::init("sample");
    let huge = "x\n".repeat(600_000);
    repo.commit_file("huge.txt", &huge, "Huge");
    let commit = rev(&repo, "HEAD");

    let collapsed = diff_of(&repo, &diff_request(&commit, 0, "huge.txt"));
    let mut request = diff_request(&commit, 0, "huge.txt");
    request.load_large = true;
    let loaded = diff_of(&repo, &request);

    assert!(matches!(collapsed.content, DiffContent::Collapsed { .. }));
    assert!(matches!(loaded.content, DiffContent::Text { .. }));
}

#[test]
fn a_binary_file_in_a_commit_shows_only_its_size() {
    let repo = TempRepo::init("sample");
    repo.write_file("logo.bin", [0u8, 1, 2, 3])
        .stage("logo.bin");
    repo.git(&["commit", "--message", "Add logo"]);

    let diff = diff_of(&repo, &diff_request(&rev(&repo, "HEAD"), 0, "logo.bin"));

    assert_eq!(
        diff.content,
        DiffContent::Binary {
            old_bytes: None,
            new_bytes: Some(4)
        }
    );
}
