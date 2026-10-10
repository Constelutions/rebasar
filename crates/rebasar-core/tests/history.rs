use rebasar_core::{
    ApiError, Core, Edge, EdgeKind, HistoryFilter, HistoryPage, HistoryRow, RefKind, RefLabel,
};
use rebasar_testkit::TempRepo;

fn history(repo: &TempRepo, offset: usize, limit: usize) -> HistoryPage {
    Core::new(|_| {})
        .history_page(repo.path(), offset, limit, &HistoryFilter::default())
        .expect("history page")
}

fn all_rows(repo: &TempRepo) -> Vec<HistoryRow> {
    history(repo, 0, 1_000).rows
}

fn subjects(rows: &[HistoryRow]) -> Vec<&str> {
    rows.iter().map(|row| row.subject.as_str()).collect()
}

fn row<'a>(rows: &'a [HistoryRow], subject: &str) -> &'a HistoryRow {
    rows.iter()
        .find(|row| row.subject == subject)
        .unwrap_or_else(|| panic!("no commit `{subject}` in {:?}", subjects(rows)))
}

fn edge(kind: EdgeKind, lane: usize) -> Edge {
    Edge { kind, lane }
}

fn label(kind: RefKind, name: &str) -> RefLabel {
    RefLabel {
        kind,
        name: name.to_owned(),
    }
}

fn linear_repo(commits: usize) -> TempRepo {
    let repo = TempRepo::init("sample");
    for number in 1..=commits {
        repo.commit_file("file.txt", &number.to_string(), &format!("Commit {number}"));
    }
    repo
}

/// main: A - B - M, feature: B - F, with M merging feature.
fn merged_feature_repo() -> TempRepo {
    let repo = TempRepo::init("sample");
    repo.commit_file("a.txt", "a", "A")
        .commit_file("b.txt", "b", "B")
        .create_branch("feature")
        .commit_file("f.txt", "f", "F")
        .checkout("main")
        .commit_file("m.txt", "m", "M")
        .merge("feature");
    repo
}

#[test]
fn commits_are_listed_newest_first_with_who_wrote_them_and_when() {
    let repo = linear_repo(3);

    let rows = all_rows(&repo);

    assert_eq!(subjects(&rows), ["Commit 3", "Commit 2", "Commit 1"]);
    assert_eq!(rows[0].id, repo.head_commit());
    assert_eq!(rows[0].short_id, repo.head_commit()[..7]);
    assert_eq!(rows[0].author_name, "Test Author");
    assert_eq!(rows[0].author_email, "author@example.com");
    assert!(rows[0].timestamp > rows[1].timestamp);
}

#[test]
fn a_linear_history_stays_in_one_lane() {
    let repo = linear_repo(3);

    let rows = all_rows(&repo);

    for row in &rows {
        assert_eq!(row.lane, 0);
        assert_eq!(row.lane_count, 1);
    }
    assert_eq!(rows[0].edges, [edge(EdgeKind::Outgoing, 0)]);
    assert_eq!(
        rows[1].edges,
        [edge(EdgeKind::Incoming, 0), edge(EdgeKind::Outgoing, 0)]
    );
    assert_eq!(rows[2].edges, [edge(EdgeKind::Incoming, 0)]);
}

#[test]
fn a_page_holds_at_most_the_requested_number_of_rows() {
    let repo = linear_repo(5);

    let page = history(&repo, 0, 2);

    assert_eq!(subjects(&page.rows), ["Commit 5", "Commit 4"]);
    assert_eq!(page.offset, 0);
    assert!(page.has_more);
}

#[test]
fn consecutive_pages_continue_where_the_previous_one_stopped() {
    let repo = linear_repo(5);
    let core = Core::new(|_| {});

    let first = core
        .history_page(repo.path(), 0, 2, &HistoryFilter::default())
        .unwrap();
    let second = core
        .history_page(repo.path(), 2, 2, &HistoryFilter::default())
        .unwrap();
    let third = core
        .history_page(repo.path(), 4, 2, &HistoryFilter::default())
        .unwrap();

    assert_eq!(subjects(&second.rows), ["Commit 3", "Commit 2"]);
    assert!(second.has_more);
    assert_eq!(subjects(&third.rows), ["Commit 1"]);
    assert!(!third.has_more);
    let paged: Vec<_> = [first.rows, second.rows, third.rows].concat();
    assert_eq!(paged, all_rows(&repo));
}

#[test]
fn a_page_that_ends_exactly_at_the_last_commit_reports_nothing_more() {
    let repo = linear_repo(4);

    let page = history(&repo, 2, 2);

    assert_eq!(subjects(&page.rows), ["Commit 2", "Commit 1"]);
    assert!(!page.has_more);
}

#[test]
fn a_page_past_the_end_is_empty() {
    let repo = linear_repo(2);

    let page = history(&repo, 10, 5);

    assert!(page.rows.is_empty());
    assert!(!page.has_more);
}

#[test]
fn a_repository_without_commits_has_an_empty_history() {
    let repo = TempRepo::init("sample");

    let page = history(&repo, 0, 10);

    assert!(page.rows.is_empty());
    assert!(!page.has_more);
}

#[test]
fn a_folder_that_is_not_a_repository_is_reported() {
    let folder = tempfile::tempdir().expect("temp dir");

    let error = Core::new(|_| {})
        .history_page(folder.path(), 0, 10, &HistoryFilter::default())
        .expect_err("not a repository");

    assert!(
        matches!(error, ApiError::NotARepository { .. }),
        "{error:?}"
    );
}

#[test]
fn commits_carry_the_branches_tags_and_head_that_point_at_them() {
    let repo = linear_repo(3);
    repo.tag("v1.0")
        .point_ref_at_head("refs/remotes/origin/main");
    repo.git(&["branch", "release", "HEAD~1"]);
    repo.git(&["tag", "--annotate", "--message", "second", "v0.9", "HEAD~1"]);

    let rows = all_rows(&repo);

    assert_eq!(
        rows[0].refs,
        [
            label(RefKind::Head, "HEAD"),
            label(RefKind::LocalBranch, "main"),
            label(RefKind::RemoteBranch, "origin/main"),
            label(RefKind::Tag, "v1.0"),
        ]
    );
    assert_eq!(
        rows[1].refs,
        [
            label(RefKind::LocalBranch, "release"),
            label(RefKind::Tag, "v0.9"),
        ]
    );
    assert!(rows[2].refs.is_empty());
}

#[test]
fn a_detached_head_is_labelled_on_its_commit() {
    let repo = linear_repo(2);
    repo.git(&["checkout", "--detach", "HEAD~1"]);

    let rows = all_rows(&repo);

    assert_eq!(subjects(&rows), ["Commit 2", "Commit 1"]);
    assert_eq!(rows[0].refs, [label(RefKind::LocalBranch, "main")]);
    assert_eq!(rows[1].refs, [label(RefKind::Head, "HEAD")]);
}

#[test]
fn a_merge_joins_its_branch_back_into_the_lane_it_forked_from() {
    let repo = merged_feature_repo();

    let rows = all_rows(&repo);

    assert_eq!(subjects(&rows), ["Merge feature", "M", "F", "B", "A"]);
    let merge = row(&rows, "Merge feature");
    assert_eq!(merge.lane, 0);
    assert_eq!(
        merge.edges,
        [edge(EdgeKind::Outgoing, 0), edge(EdgeKind::Outgoing, 1)]
    );
    assert_eq!(merge.lane_count, 2);
}

#[test]
fn a_branch_runs_in_its_own_lane_until_it_forks_from_the_main_line() {
    let repo = merged_feature_repo();

    let rows = all_rows(&repo);

    let main_commit = row(&rows, "M");
    assert_eq!(main_commit.lane, 0);
    assert_eq!(
        main_commit.edges,
        [
            edge(EdgeKind::Incoming, 0),
            edge(EdgeKind::Through, 1),
            edge(EdgeKind::Outgoing, 0)
        ]
    );
    let feature_commit = row(&rows, "F");
    assert_eq!(feature_commit.lane, 1);
    assert_eq!(
        feature_commit.edges,
        [
            edge(EdgeKind::Through, 0),
            edge(EdgeKind::Incoming, 1),
            edge(EdgeKind::Outgoing, 0)
        ]
    );
    let fork = row(&rows, "B");
    assert_eq!(fork.lane, 0);
    assert_eq!(fork.lane_count, 1);
    assert_eq!(
        fork.edges,
        [edge(EdgeKind::Incoming, 0), edge(EdgeKind::Outgoing, 0)]
    );
}

#[test]
fn branches_that_are_not_merged_each_get_a_lane() {
    let repo = TempRepo::init("sample");
    repo.commit_file("a.txt", "a", "A")
        .create_branch("one")
        .commit_file("one.txt", "1", "One")
        .checkout("main")
        .create_branch("two")
        .commit_file("two.txt", "2", "Two")
        .checkout("main");

    let rows = all_rows(&repo);

    assert_eq!(rows.len(), 3);
    let lanes: Vec<_> = rows
        .iter()
        .map(|row| (row.subject.as_str(), row.lane))
        .collect();
    assert_eq!(lanes, [("Two", 0), ("One", 1), ("A", 0)]);
    assert_eq!(
        row(&rows, "One").edges,
        [edge(EdgeKind::Through, 0), edge(EdgeKind::Outgoing, 0)]
    );
    assert_eq!(
        row(&rows, "A").refs,
        [
            label(RefKind::Head, "HEAD"),
            label(RefKind::LocalBranch, "main")
        ]
    );
}

#[test]
fn a_lane_freed_by_a_merged_branch_is_reused() {
    let repo = merged_feature_repo();
    repo.commit_file("late.txt", "x", "Late");
    repo.create_branch("second")
        .commit_file("s.txt", "s", "S")
        .checkout("main")
        .commit_file("n.txt", "n", "N")
        .merge("second");

    let rows = all_rows(&repo);

    assert_eq!(row(&rows, "S").lane, 1);
    assert_eq!(row(&rows, "F").lane, 1);
    assert!(rows.iter().all(|row| row.lane_count <= 2));
}

#[test]
fn every_lane_that_opens_is_closed_by_the_end_of_the_history() {
    let repo = merged_feature_repo();
    repo.commit_file("late.txt", "x", "Late")
        .create_branch("second")
        .commit_file("s.txt", "s", "S")
        .checkout("main")
        .commit_file("n.txt", "n", "N")
        .merge("second");

    let rows = all_rows(&repo);

    let last = rows.last().unwrap();
    assert!(last
        .edges
        .iter()
        .all(|edge| edge.kind == EdgeKind::Incoming));
    for pair in rows.windows(2) {
        let lanes_where = |row: &HistoryRow, excluded: EdgeKind| {
            let mut lanes: Vec<_> = row
                .edges
                .iter()
                .filter(|edge| edge.kind != excluded)
                .map(|edge| edge.lane)
                .collect();
            lanes.sort_unstable();
            lanes.dedup();
            lanes
        };
        assert_eq!(
            lanes_where(&pair[0], EdgeKind::Incoming),
            lanes_where(&pair[1], EdgeKind::Outgoing),
            "the lines leaving `{}` are not the ones arriving at `{}`",
            pair[0].subject,
            pair[1].subject
        );
    }
}

#[test]
fn a_page_in_the_middle_of_the_history_has_the_same_layout_as_when_read_from_the_top() {
    let repo = merged_feature_repo();
    let core = Core::new(|_| {});

    let middle = core
        .history_page(repo.path(), 2, 2, &HistoryFilter::default())
        .unwrap();

    assert_eq!(middle.rows, all_rows(&repo)[2..4]);
}

#[test]
fn new_commits_appear_at_the_top_of_a_history_that_was_already_read() {
    let repo = linear_repo(2);
    let core = Core::new(|_| {});
    core.history_page(repo.path(), 0, 10, &HistoryFilter::default())
        .unwrap();

    repo.commit_file("file.txt", "3", "Commit 3");
    let page = core
        .history_page(repo.path(), 0, 10, &HistoryFilter::default())
        .unwrap();

    assert_eq!(subjects(&page.rows), ["Commit 3", "Commit 2", "Commit 1"]);
}

#[test]
fn a_commit_whose_clock_is_behind_its_parents_does_not_break_the_layout() {
    let repo = TempRepo::init("sample");
    repo.commit_file_dated("a.txt", "a", "A", 1_700_000_000)
        .create_branch("feature")
        .commit_file_dated("f.txt", "f", "F", 1_600_000_000)
        .checkout("main")
        .commit_file_dated("m.txt", "m", "M", 1_700_000_500)
        .merge("feature")
        .commit_file_dated("z.txt", "z", "Z", 1_700_001_000);

    let rows = all_rows(&repo);

    let mut listed = subjects(&rows);
    listed.sort_unstable();
    assert_eq!(listed, ["A", "F", "M", "Merge feature", "Z"]);
}
