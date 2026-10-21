use rebasar_core::{ApiError, Core, EdgeKind, HistoryCount, HistoryFilter, HistoryRow, RefKind};
use rebasar_testkit::{IsolatedGitConfig, TempRepo};

const ADA: (&str, &str) = ("Ada Lovelace", "ada@example.com");
const GRACE: (&str, &str) = ("Grace Hopper", "grace@example.com");

fn query(text: &str) -> HistoryFilter {
    HistoryFilter {
        query: text.to_owned(),
        ..HistoryFilter::default()
    }
}

fn rows(repo: &TempRepo, filter: &HistoryFilter) -> Vec<HistoryRow> {
    Core::new(|_| {})
        .history_page(repo.path(), 0, 1_000, filter)
        .expect("history page")
        .rows
}

fn subjects(repo: &TempRepo, filter: &HistoryFilter) -> Vec<String> {
    rows(repo, filter)
        .into_iter()
        .map(|row| row.subject)
        .collect()
}

fn found(repo: &TempRepo, text: &str) -> Vec<String> {
    subjects(repo, &query(text))
}

fn count(repo: &TempRepo, filter: &HistoryFilter) -> HistoryCount {
    Core::new(|_| {})
        .history_count(repo.path(), filter)
        .expect("history count")
}

/// main: Add parser (Ada) - Fix lexer (Grace, with a body) - Update docs (Ada) - Merge feature,
/// feature: branched after Fix lexer, with Grace's Feature work.
fn team_repo() -> TempRepo {
    let repo = TempRepo::init("sample");
    repo.commit_file_as(ADA, "src/parser.rs", "p", "Add parser")
        .commit_file_as(
            GRACE,
            "src/lexer.rs",
            "l",
            "Fix lexer\n\nHandles unicode identifiers",
        )
        .create_branch("feature")
        .commit_file_as(GRACE, "src/feature/mod.rs", "f", "Feature work")
        .checkout("main")
        .commit_file_as(ADA, "docs/readme.md", "d", "Update docs")
        .merge("feature");
    repo
}

#[test]
fn author_matches_the_name_or_the_email_ignoring_case() {
    let repo = team_repo();

    assert_eq!(found(&repo, "author:grace"), ["Feature work", "Fix lexer"]);
    assert_eq!(
        found(&repo, "author:ADA@EXAMPLE"),
        ["Update docs", "Add parser"]
    );
    assert_eq!(
        found(&repo, r#"author:"ada lovelace""#),
        ["Update docs", "Add parser"]
    );
    assert_eq!(found(&repo, "author:nobody"), Vec::<String>::new());
}

#[test]
fn bare_words_and_msg_search_the_whole_message_ignoring_case() {
    let repo = team_repo();

    assert_eq!(found(&repo, "lexer"), ["Fix lexer"]);
    assert_eq!(found(&repo, "msg:PARSER"), ["Add parser"]);
    assert_eq!(found(&repo, "unicode"), ["Fix lexer"]);
    assert_eq!(found(&repo, r#""feature work""#), ["Feature work"]);
}

#[test]
fn several_words_must_all_appear_in_the_message() {
    let repo = team_repo();

    assert_eq!(found(&repo, "fix unicode"), ["Fix lexer"]);
    assert_eq!(found(&repo, "fix parser"), Vec::<String>::new());
}

#[test]
fn path_matches_commits_that_changed_a_file() {
    let repo = team_repo();

    assert_eq!(found(&repo, "path:src/lexer.rs"), ["Fix lexer"]);
    assert_eq!(found(&repo, r"path:src\lexer.rs"), ["Fix lexer"]);
}

#[test]
fn path_matches_commits_that_changed_anything_inside_a_folder() {
    let repo = team_repo();

    assert_eq!(
        found(&repo, "path:src"),
        ["Feature work", "Fix lexer", "Add parser"]
    );
    assert_eq!(found(&repo, "path:src/feature/"), ["Feature work"]);
    assert_eq!(found(&repo, "path:missing"), Vec::<String>::new());
}

#[test]
fn path_ignores_a_merge_that_only_brings_in_the_changes_of_a_branch() {
    let repo = team_repo();

    let subjects = found(&repo, "path:src/feature/mod.rs");

    assert_eq!(subjects, ["Feature work"]);
}

#[test]
fn path_counts_the_first_commit_of_a_file() {
    let repo = TempRepo::init("sample");
    repo.commit_file("a.txt", "a", "Add a")
        .commit_file("b.txt", "b", "Add b");

    assert_eq!(found(&repo, "path:a.txt"), ["Add a"]);
}

#[test]
fn branch_shows_only_the_history_of_the_matching_branches() {
    let repo = team_repo();
    repo.checkout("main")
        .git(&["branch", "release/1.0", "HEAD~1"]);

    assert_eq!(
        found(&repo, "branch:feature"),
        ["Feature work", "Fix lexer", "Add parser"]
    );
    assert_eq!(
        found(&repo, "branch:release"),
        ["Update docs", "Fix lexer", "Add parser"]
    );
    assert_eq!(found(&repo, "branch:RELEASE branch:feature").len(), 4);
    assert_eq!(found(&repo, "branch:nothing"), Vec::<String>::new());
}

#[test]
fn branch_also_matches_remote_branches_but_not_tags() {
    let repo = TempRepo::init("sample");
    repo.commit_file("a.txt", "a", "Add a")
        .point_ref_at_head("refs/remotes/origin/topic")
        .tag("topic-tag")
        .commit_file("b.txt", "b", "Add b");

    assert_eq!(found(&repo, "branch:origin/topic"), ["Add a"]);
    assert_eq!(found(&repo, "branch:topic-tag"), Vec::<String>::new());
}

#[test]
fn since_and_until_include_the_whole_day_they_name() {
    const JAN_1: u64 = 1_704_067_200;
    let at = |day: u64, hour: u64| JAN_1 + (day - 1) * 86_400 + hour * 3_600;
    let repo = TempRepo::init("sample");
    repo.commit_file_dated("a", "1", "Jan 9 late", at(9, 23))
        .commit_file_dated("a", "2", "Jan 10 early", at(10, 0))
        .commit_file_dated("a", "3", "Jan 10 late", at(10, 23))
        .commit_file_dated("a", "4", "Jan 11 early", at(11, 0));

    assert_eq!(
        found(&repo, "since:2024-01-10"),
        ["Jan 11 early", "Jan 10 late", "Jan 10 early"]
    );
    assert_eq!(
        found(&repo, "until:2024-01-10"),
        ["Jan 10 late", "Jan 10 early", "Jan 9 late"]
    );
    assert_eq!(
        found(&repo, "since:2024-01-10 until:2024-01-10"),
        ["Jan 10 late", "Jan 10 early"]
    );
    assert_eq!(
        found(&repo, "since:2024-01-11 until:2024-01-10"),
        Vec::<String>::new()
    );
}

#[test]
fn the_merges_chip_keeps_only_merge_commits() {
    let repo = team_repo();

    let merges = HistoryFilter {
        merges: true,
        ..HistoryFilter::default()
    };

    assert_eq!(subjects(&repo, &merges), ["Merge feature"]);
}

#[test]
fn the_me_author_is_the_email_in_the_repository_configuration() {
    let repo = TempRepo::init("sample");
    repo.git(&["config", "user.email", "grace@example.com"]);
    repo.commit_file_as(ADA, "a", "1", "By Ada")
        .commit_file_as(("G. Hopper", "GRACE@example.com"), "a", "2", "By Grace")
        .commit_file_as(ADA, "a", "3", "By Ada again");

    assert_eq!(found(&repo, "author:@me"), ["By Grace"]);
}

#[test]
fn the_me_author_is_matched_ignoring_case() {
    let repo = TempRepo::init("sample");
    repo.git(&["config", "user.email", "grace@example.com"]);
    repo.commit_file_as(ADA, "a", "1", "By Ada")
        .commit_file_as(GRACE, "a", "2", "By Grace");

    assert_eq!(found(&repo, "author:@ME"), ["By Grace"]);
    assert_eq!(found(&repo, "author:@Me"), ["By Grace"]);
}

#[test]
fn the_me_author_needs_an_email_in_the_configuration() {
    let _git = IsolatedGitConfig::new();
    let repo = TempRepo::init("sample");
    repo.git(&["config", "--unset", "user.email"]);
    repo.commit_file_as(ADA, "a", "1", "By Ada");

    let error = Core::new(|_| {})
        .history_page(repo.path(), 0, 10, &query("author:@me"))
        .expect_err("no email to stand for me");

    assert!(matches!(error, ApiError::Unexpected { .. }), "{error:?}");
}

#[test]
fn several_author_terms_match_the_commits_of_any_of_them() {
    let repo = team_repo();

    assert_eq!(
        found(&repo, "author:ada author:grace"),
        ["Update docs", "Feature work", "Fix lexer", "Add parser"]
    );
    assert_eq!(
        found(&repo, "author:ada author:nobody"),
        ["Update docs", "Add parser"]
    );
    assert_eq!(found(&repo, "author:ada author:grace fix"), ["Fix lexer"]);
}

#[test]
fn me_joins_the_other_author_terms_as_one_more_alternative() {
    let repo = team_repo();
    repo.git(&["config", "user.email", "grace@example.com"]);

    assert_eq!(
        found(&repo, "author:@me author:ada"),
        ["Update docs", "Feature work", "Fix lexer", "Add parser"]
    );
    assert_eq!(found(&repo, "author:@me author:nobody"), ["Feature work", "Fix lexer"]);
}

#[test]
fn turning_all_branches_off_keeps_only_what_the_current_branch_reaches() {
    let repo = team_repo();
    repo.checkout("feature");

    let current_branch = HistoryFilter {
        all_branches: false,
        ..HistoryFilter::default()
    };

    assert_eq!(
        subjects(&repo, &current_branch),
        ["Feature work", "Fix lexer", "Add parser"]
    );
    assert_eq!(rows(&repo, &HistoryFilter::default()).len(), 5);
}

#[test]
fn a_branch_term_wins_over_the_all_branches_chip() {
    let repo = team_repo();
    repo.checkout("feature");

    let filter = HistoryFilter {
        all_branches: false,
        ..query("branch:main")
    };

    assert_eq!(subjects(&repo, &filter).len(), 5);
}

#[test]
fn every_key_and_chip_combines_with_and() {
    let repo = team_repo();

    assert_eq!(
        found(&repo, "author:grace path:src/feature"),
        ["Feature work"]
    );
    assert_eq!(
        found(&repo, "author:ada path:src/feature"),
        Vec::<String>::new()
    );
    assert_eq!(found(&repo, "author:grace fix"), ["Fix lexer"]);
    assert_eq!(found(&repo, "branch:feature author:ada"), ["Add parser"]);

    let merges = HistoryFilter {
        merges: true,
        ..query("author:ada")
    };
    assert_eq!(subjects(&repo, &merges), Vec::<String>::new());
    repo.git(&["config", "user.email", "grace@example.com"]);
    assert_eq!(
        found(&repo, "author:@me path:src"),
        ["Feature work", "Fix lexer"]
    );
}

#[test]
fn refs_still_label_the_commits_that_pass_the_filter() {
    let repo = team_repo();

    let rows = rows(&repo, &query("author:grace"));

    let feature = &rows[0];
    assert!(feature
        .refs
        .iter()
        .any(|label| label.kind == RefKind::LocalBranch && label.name == "feature"));
}

#[test]
fn the_lines_join_the_nearest_commits_that_remain() {
    let repo = TempRepo::init("sample");
    repo.commit_file("f", "1", "Keep one")
        .commit_file("f", "2", "Drop")
        .commit_file("f", "3", "Drop too")
        .commit_file("f", "4", "Keep two");

    let rows = rows(&repo, &query("keep"));

    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0].edges.len(), 1);
    assert_eq!(
        (rows[0].edges[0].kind, rows[0].edges[0].lane),
        (EdgeKind::Outgoing, 0)
    );
    assert_eq!(rows[1].edges.len(), 1);
    assert_eq!(
        (rows[1].edges[0].kind, rows[1].edges[0].lane),
        (EdgeKind::Incoming, 0)
    );
}

#[test]
fn a_merge_whose_branch_commits_are_filtered_out_still_links_both_parents() {
    let repo = team_repo();

    let merge_and_roots = rows(&repo, &query("author:ada"));

    let subjects: Vec<_> = merge_and_roots
        .iter()
        .map(|row| row.subject.as_str())
        .collect();
    assert_eq!(subjects, ["Update docs", "Add parser"]);
    assert_eq!(merge_and_roots[1].edges.len(), 1);
    assert_eq!(merge_and_roots[1].edges[0].kind, EdgeKind::Incoming);
}

#[test]
fn a_filtered_history_can_be_read_page_by_page() {
    let repo = TempRepo::init("sample");
    for number in 1..=6 {
        repo.commit_file("f", &number.to_string(), &format!("Odd {number}"));
        repo.commit_file("f", &format!("{number}x"), &format!("Even {number}"));
    }
    let core = Core::new(|_| {});
    let filter = query("odd");

    let first = core.history_page(repo.path(), 0, 4, &filter).unwrap();
    let second = core.history_page(repo.path(), 4, 4, &filter).unwrap();

    assert_eq!(first.rows.len(), 4);
    assert!(first.has_more);
    assert_eq!(second.rows.len(), 2);
    assert!(!second.has_more);
}

#[test]
fn changing_the_filter_between_pages_starts_the_layout_over() {
    let repo = team_repo();
    let core = Core::new(|_| {});

    let everything = core
        .history_page(repo.path(), 0, 10, &HistoryFilter::default())
        .unwrap();
    let filtered = core
        .history_page(repo.path(), 0, 10, &query("author:grace"))
        .unwrap();
    let everything_again = core
        .history_page(repo.path(), 0, 10, &HistoryFilter::default())
        .unwrap();

    assert_eq!(everything.rows.len(), 5);
    assert_eq!(filtered.rows.len(), 2);
    assert_eq!(everything_again, everything);
}

#[test]
fn the_count_is_the_number_of_matching_commits_out_of_every_commit() {
    let repo = team_repo();

    assert_eq!(
        count(&repo, &HistoryFilter::default()),
        HistoryCount {
            matching: 5,
            total: 5
        }
    );
    assert_eq!(
        count(&repo, &query("author:grace")),
        HistoryCount {
            matching: 2,
            total: 5
        }
    );
    assert_eq!(
        count(&repo, &query("author:nobody")),
        HistoryCount {
            matching: 0,
            total: 5
        }
    );
}

#[test]
fn the_count_covers_every_key_and_chip() {
    let repo = team_repo();
    repo.checkout("feature");

    let merges = HistoryFilter {
        merges: true,
        ..HistoryFilter::default()
    };
    let current_branch = HistoryFilter {
        all_branches: false,
        ..HistoryFilter::default()
    };

    assert_eq!(count(&repo, &merges).matching, 1);
    assert_eq!(count(&repo, &current_branch).matching, 3);
    assert_eq!(count(&repo, &query("branch:main")).matching, 5);
    assert_eq!(count(&repo, &query("path:src/feature")).matching, 1);
    assert_eq!(count(&repo, &query("since:2000-01-01")).matching, 5);
    assert_eq!(count(&repo, &query("until:2000-01-01")).matching, 0);
}

#[test]
fn the_count_matches_the_rows_the_pages_deliver() {
    let repo = team_repo();
    repo.git(&["config", "user.email", "grace@example.com"]);
    repo.git(&["branch", "release", "HEAD~1"]);

    for filter in [
        query("author:ada"),
        query("path:src"),
        query("branch:release"),
        query("fix OR"),
        HistoryFilter {
            merges: true,
            ..HistoryFilter::default()
        },
        query("author:ada author:grace"),
        query("author:@me lexer"),
    ] {
        assert_eq!(
            count(&repo, &filter).matching,
            rows(&repo, &filter).len(),
            "{filter:?}"
        );
    }
}

#[test]
fn the_total_follows_the_refs() {
    let repo = team_repo();
    let core = Core::new(|_| {});
    assert_eq!(
        core.history_count(repo.path(), &HistoryFilter::default())
            .unwrap()
            .total,
        5
    );

    repo.commit_file("later.txt", "x", "One more");

    assert_eq!(
        core.history_count(repo.path(), &HistoryFilter::default())
            .unwrap()
            .total,
        6
    );
}

#[test]
fn a_malformed_query_is_reported_with_where_it_went_wrong() {
    let repo = team_repo();
    let core = Core::new(|_| {});
    let filter = query("fix since:soon");

    let page = core.history_page(repo.path(), 0, 10, &filter).unwrap_err();
    let counted = core.history_count(repo.path(), &filter).unwrap_err();

    assert_eq!(page, counted);
    match page {
        ApiError::InvalidQuery {
            message,
            start,
            end,
        } => {
            assert!(message.contains("since:"), "{message}");
            assert_eq!((start, end), (4, 14));
        }
        other => panic!("expected an invalid query, got {other:?}"),
    }
}
