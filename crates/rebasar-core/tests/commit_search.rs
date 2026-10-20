use rebasar_core::{ApiError, CommitHit, Core, RefKind};
use rebasar_testkit::TempRepo;

const ADA: (&str, &str) = ("Ada Lovelace", "ada@example.com");
const GRACE: (&str, &str) = ("Grace Hopper", "grace@example.com");

fn find(repo: &TempRepo, query: &str) -> Vec<CommitHit> {
    find_at_most(repo, query, 50)
}

fn find_at_most(repo: &TempRepo, query: &str, limit: usize) -> Vec<CommitHit> {
    Core::new(|_| {})
        .find_commits(repo.path(), query, limit)
        .expect("find commits")
}

fn subjects(hits: &[CommitHit]) -> Vec<&str> {
    hits.iter().map(|hit| hit.subject.as_str()).collect()
}

fn team_repo() -> TempRepo {
    let repo = TempRepo::init("sample");
    repo.commit_file_as(ADA, "src/parser.rs", "p", "Add parser")
        .commit_file_as(GRACE, "src/lexer.rs", "l", "Fix lexer")
        .create_branch("feature")
        .commit_file_as(GRACE, "src/feature.rs", "f", "Fix feature parser")
        .checkout("main")
        .commit_file_as(ADA, "docs/readme.md", "d", "Update docs");
    repo
}

#[test]
fn text_finds_the_commits_whose_message_contains_it_newest_first() {
    let repo = team_repo();

    let hits = find(&repo, "parser");

    assert_eq!(subjects(&hits), ["Fix feature parser", "Add parser"]);
}

#[test]
fn a_hit_carries_what_the_palette_lists() {
    let repo = TempRepo::init("sample");
    repo.commit_file_as(ADA, "a.txt", "a", "Add a");
    let head = repo.head_commit();

    let hits = find(&repo, "add");

    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].id, head);
    assert_eq!(hits[0].short_id, head[..7]);
    assert_eq!(hits[0].author_name, "Ada Lovelace");
    assert_eq!(hits[0].subject, "Add a");
}

#[test]
fn the_filter_syntax_of_history_applies() {
    let repo = team_repo();

    assert_eq!(
        subjects(&find(&repo, "author:grace")),
        ["Fix feature parser", "Fix lexer"]
    );
    assert_eq!(
        subjects(&find(&repo, "author:grace parser")),
        ["Fix feature parser"]
    );
    assert_eq!(subjects(&find(&repo, "path:src/lexer.rs")), ["Fix lexer"]);
    assert_eq!(
        subjects(&find(&repo, "branch:feature msg:lexer")),
        ["Fix lexer"]
    );
}

#[test]
fn several_authors_and_me_widen_the_search() {
    let repo = team_repo();
    repo.git(&["config", "user.email", "ada@example.com"]);

    assert_eq!(
        subjects(&find(&repo, "author:grace author:@me parser")),
        ["Fix feature parser", "Add parser"]
    );
    assert_eq!(
        subjects(&find(&repo, "author:@me")),
        ["Update docs", "Add parser"]
    );
}

#[test]
fn a_full_hash_finds_its_commit() {
    let repo = team_repo();
    let head = repo.head_commit();

    let hits = find(&repo, &head);

    assert_eq!(subjects(&hits), ["Update docs"]);
}

#[test]
fn an_abbreviated_hash_finds_its_commit_whatever_the_case() {
    let repo = team_repo();
    let head = repo.head_commit();

    assert_eq!(subjects(&find(&repo, &head[..7])), ["Update docs"]);
    assert_eq!(
        subjects(&find(&repo, &head[..10].to_uppercase())),
        ["Update docs"]
    );
}

#[test]
fn a_hash_finds_a_commit_that_only_another_branch_reaches() {
    let repo = team_repo();
    repo.checkout("feature");
    let tip = repo.head_commit();
    repo.checkout("main");

    assert_eq!(subjects(&find(&repo, &tip[..8])), ["Fix feature parser"]);
}

#[test]
fn a_hash_comes_before_the_commits_whose_message_happens_to_contain_it() {
    let repo = TempRepo::init("sample");
    repo.commit_file_as(ADA, "a.txt", "a", "Add a");
    let first = repo.head_commit();
    repo.commit_file_as(ADA, "b.txt", "b", &format!("Revert {}", &first[..7]));

    let hits = find(&repo, &first[..7]);

    assert_eq!(
        subjects(&hits),
        ["Add a", &format!("Revert {}", &first[..7])]
    );
}

#[test]
fn an_unknown_hash_finds_nothing() {
    let repo = team_repo();

    assert!(find(&repo, "deadbeef").is_empty());
}

#[test]
fn a_word_that_looks_like_hex_still_searches_messages() {
    let repo = TempRepo::init("sample");
    repo.commit_file_as(ADA, "a.txt", "a", "Add a facade");

    assert_eq!(subjects(&find(&repo, "facade")), ["Add a facade"]);
    assert_eq!(subjects(&find(&repo, "fac")), ["Add a facade"]);
}

#[test]
fn the_limit_keeps_the_newest_commits() {
    let repo = team_repo();

    let hits = find_at_most(&repo, "", 2);

    assert_eq!(subjects(&hits), ["Update docs", "Fix feature parser"]);
}

#[test]
fn a_malformed_query_is_reported_with_its_position() {
    let repo = team_repo();

    let error = Core::new(|_| {})
        .find_commits(repo.path(), "fix author:", 10)
        .expect_err("malformed query");

    assert!(matches!(
        error,
        ApiError::InvalidQuery {
            start: 4,
            end: 11,
            ..
        }
    ));
}

#[test]
fn a_folder_that_is_not_a_repository_is_refused() {
    let folder = tempfile::tempdir().unwrap();

    let error = Core::new(|_| {})
        .find_commits(folder.path(), "x", 10)
        .expect_err("not a repository");

    assert!(matches!(error, ApiError::NotARepository { .. }));
}

#[test]
fn branches_lists_local_and_remote_branches_by_name() {
    let repo = team_repo();
    repo.tag("v1").point_ref_at_head("refs/remotes/origin/main");

    let branches = Core::new(|_| {})
        .list_branches(repo.path())
        .expect("list branches");

    let named: Vec<(RefKind, &str)> = branches
        .iter()
        .map(|branch| (branch.kind, branch.name.as_str()))
        .collect();
    assert_eq!(
        named,
        [
            (RefKind::LocalBranch, "feature"),
            (RefKind::LocalBranch, "main"),
            (RefKind::RemoteBranch, "origin/main"),
        ]
    );
}
