use rebasar_core::{
    ApiError, ChangeKind, Core, DiffContent, LineKind, MutationOutcome, WorktreeDiffRequest,
};
use rebasar_testkit::TempRepo;

fn repo_with_two_commits() -> (TempRepo, String, String) {
    let repo = TempRepo::init("sample");
    repo.commit_file("a.txt", "one\n", "First");
    let first = repo.head_commit();
    repo.commit_file("b.txt", "two\n", "Second");
    let second = repo.head_commit();
    (repo, first, second)
}

fn core() -> Core {
    Core::new(|_| {})
}

fn head_subject(repo: &TempRepo) -> String {
    repo.git(&["log", "-1", "--format=%s"]).trim().to_owned()
}

#[test]
fn checking_out_a_commit_detaches_head_there() {
    let (repo, first, _) = repo_with_two_commits();

    let outcome = core().checkout_commit(repo.path(), &first).expect("checkout");

    assert_eq!(outcome, MutationOutcome::Succeeded);
    assert_eq!(repo.head_commit(), first);
    repo.git_fails(&["symbolic-ref", "--quiet", "HEAD"]);
}

#[test]
fn checking_out_a_commit_that_would_overwrite_changes_fails_and_changes_nothing() {
    let repo = TempRepo::init("sample");
    repo.commit_file("a.txt", "one
", "First");
    let first = repo.head_commit();
    repo.commit_file("a.txt", "newer
", "Second");
    let second = repo.head_commit();
    repo.write_file("a.txt", "newer
local edit
");

    let outcome = core().checkout_commit(repo.path(), &first).expect("checkout");

    assert_eq!(outcome, MutationOutcome::Failed { exit_code: Some(1) });
    assert_eq!(repo.head_commit(), second);
    assert_eq!(repo.git(&["branch", "--show-current"]).trim(), "main");
}

#[test]
fn a_branch_created_here_points_at_the_commit_and_leaves_head_alone() {
    let (repo, first, second) = repo_with_two_commits();

    let outcome = core()
        .create_branch(repo.path(), "topic", &first)
        .expect("create branch");

    assert_eq!(outcome, MutationOutcome::Succeeded);
    assert_eq!(repo.git(&["rev-parse", "topic"]).trim(), first);
    assert_eq!(repo.head_commit(), second);
    assert_eq!(repo.git(&["branch", "--show-current"]).trim(), "main");
}

#[test]
fn a_branch_name_git_rejects_fails_without_creating_anything() {
    let (repo, first, _) = repo_with_two_commits();

    let outcome = core()
        .create_branch(repo.path(), "not a branch~name", &first)
        .expect("create branch");

    assert_eq!(outcome, MutationOutcome::Failed { exit_code: Some(128) });
    assert_eq!(repo.git(&["branch", "--list"]).trim(), "* main");
}

#[test]
fn a_branch_name_that_looks_like_an_option_is_a_name_not_an_option() {
    let (repo, first, _) = repo_with_two_commits();

    let outcome = core()
        .create_branch(repo.path(), "--delete", &first)
        .expect("create branch");

    assert!(matches!(outcome, MutationOutcome::Failed { .. }));
    assert_eq!(repo.git(&["branch", "--list"]).trim(), "* main");
}

#[test]
fn a_tag_created_here_points_at_the_commit() {
    let (repo, first, _) = repo_with_two_commits();

    let outcome = core()
        .create_tag(repo.path(), "v1", &first)
        .expect("create tag");

    assert_eq!(outcome, MutationOutcome::Succeeded);
    assert_eq!(repo.git(&["rev-parse", "v1^{commit}"]).trim(), first);
}

#[test]
fn a_tag_that_already_exists_is_not_moved() {
    let (repo, first, second) = repo_with_two_commits();
    core().create_tag(repo.path(), "v1", &first).expect("tag");

    let outcome = core()
        .create_tag(repo.path(), "v1", &second)
        .expect("create tag");

    assert!(matches!(outcome, MutationOutcome::Failed { .. }));
    assert_eq!(repo.git(&["rev-parse", "v1^{commit}"]).trim(), first);
}

#[test]
fn something_that_is_not_a_commit_id_is_rejected_before_git_runs() {
    let (repo, _, _) = repo_with_two_commits();

    for bad in ["--orphan", "main", "abc", ""] {
        let result = core().create_tag(repo.path(), "v1", bad);
        assert!(
            matches!(result, Err(ApiError::Unexpected { .. })),
            "`{bad}` was accepted"
        );
    }
}

#[test]
fn rewording_the_latest_commit_changes_only_its_message() {
    let (repo, _, second) = repo_with_two_commits();
    let tree_before = repo.git(&["rev-parse", "HEAD^{tree}"]);

    let outcome = core()
        .reword_latest_commit(repo.path(), &second, "A better message")
        .expect("reword");

    assert_eq!(outcome, MutationOutcome::Succeeded);
    assert_eq!(head_subject(&repo), "A better message");
    assert_eq!(repo.git(&["rev-parse", "HEAD^{tree}"]), tree_before);
    assert_eq!(repo.git(&["rev-list", "--count", "HEAD"]).trim(), "2");
}

#[test]
fn rewording_leaves_staged_changes_staged_and_out_of_the_commit() {
    let (repo, _, second) = repo_with_two_commits();
    repo.write_file("c.txt", "three\n").stage("c.txt");

    core()
        .reword_latest_commit(repo.path(), &second, "A better message")
        .expect("reword");

    let status = core().worktree_status(repo.path()).expect("status");
    assert_eq!(status.staged.len(), 1);
    assert_eq!(status.staged[0].path, "c.txt");
    assert_eq!(status.staged[0].kind, ChangeKind::Added);
    assert_eq!(repo.git(&["show", "--name-only", "--format=", "HEAD"]).trim(), "b.txt");
}

#[test]
fn rewording_a_commit_that_is_not_the_latest_is_refused() {
    let (repo, first, second) = repo_with_two_commits();

    let result = core().reword_latest_commit(repo.path(), &first, "Nope");

    assert!(matches!(result, Err(ApiError::Unexpected { .. })));
    assert_eq!(repo.head_commit(), second);
    assert_eq!(head_subject(&repo), "Second");
}

#[test]
fn rewording_runs_the_commit_msg_hook_and_reports_its_rejection() {
    let (repo, _, second) = repo_with_two_commits();
    repo.install_hook("commit-msg", "echo 'no tabs please' >&2\nexit 1");

    let outcome = core()
        .reword_latest_commit(repo.path(), &second, "Rejected")
        .expect("reword");

    assert_eq!(outcome, MutationOutcome::Failed { exit_code: Some(1) });
    assert_eq!(head_subject(&repo), "Second");
}

fn comparison(repo: &TempRepo, commit: &str) -> Vec<(String, ChangeKind, Option<u32>, Option<u32>)> {
    core()
        .compare_with_worktree(repo.path(), commit)
        .expect("compare")
        .into_iter()
        .map(|file| (file.path, file.kind, file.added, file.removed))
        .collect()
}

#[test]
fn a_clean_working_tree_at_the_commit_has_no_differences() {
    let (repo, _, second) = repo_with_two_commits();

    assert!(comparison(&repo, &second).is_empty());
}

#[test]
fn comparing_an_older_commit_lists_what_changed_since_then() {
    let (repo, first, _) = repo_with_two_commits();

    assert_eq!(
        comparison(&repo, &first),
        [("b.txt".to_owned(), ChangeKind::Added, Some(1), Some(0))]
    );
}

#[test]
fn comparison_includes_uncommitted_edits_staged_or_not_and_deletions() {
    let (repo, first, _) = repo_with_two_commits();
    repo.write_file("a.txt", "one\nmore\n");
    repo.write_file("c.txt", "staged\n").stage("c.txt");
    repo.delete_file("b.txt");

    assert_eq!(
        comparison(&repo, &first),
        [
            ("a.txt".to_owned(), ChangeKind::Modified, Some(1), Some(0)),
            ("c.txt".to_owned(), ChangeKind::Added, Some(1), Some(0)),
        ]
    );
}

#[test]
fn comparison_leaves_out_untracked_files_and_files_edited_back_to_the_commit() {
    let (repo, first, _) = repo_with_two_commits();
    repo.write_file("untracked.txt", "x\n");
    repo.write_file("a.txt", "changed\n");
    repo.write_file("a.txt", "one\n");

    let paths: Vec<_> = comparison(&repo, &first)
        .into_iter()
        .map(|(path, ..)| path)
        .collect();

    assert_eq!(paths, ["b.txt"]);
}

#[test]
fn the_diff_of_a_compared_file_goes_from_the_commit_to_the_file_on_disk() {
    let (repo, first, _) = repo_with_two_commits();
    repo.write_file("a.txt", "one\nmore\n");

    let diff = core()
        .compare_file_diff(
            repo.path(),
            &WorktreeDiffRequest {
                commit: first,
                path: "a.txt".to_owned(),
                load_large: false,
            },
        )
        .expect("diff");

    let DiffContent::Text { hunks } = diff.content else {
        panic!("expected a text diff");
    };
    let changed: Vec<_> = hunks
        .iter()
        .flat_map(|hunk| &hunk.lines)
        .filter(|line| line.kind != LineKind::Context)
        .map(|line| (line.kind, line.text.as_str()))
        .collect();
    assert_eq!(changed, [(LineKind::Added, "more")]);
}

#[test]
fn a_compared_file_that_was_deleted_on_disk_diffs_to_nothing() {
    let (repo, _, second) = repo_with_two_commits();
    repo.delete_file("b.txt");

    let diff = core()
        .compare_file_diff(
            repo.path(),
            &WorktreeDiffRequest {
                commit: second,
                path: "b.txt".to_owned(),
                load_large: false,
            },
        )
        .expect("diff");

    let DiffContent::Text { hunks } = diff.content else {
        panic!("expected a text diff");
    };
    assert!(hunks
        .iter()
        .flat_map(|hunk| &hunk.lines)
        .all(|line| line.kind == LineKind::Removed));
}

#[test]
fn a_compare_diff_request_cannot_leave_the_worktree() {
    let (repo, first, _) = repo_with_two_commits();

    let result = core().compare_file_diff(
        repo.path(),
        &WorktreeDiffRequest {
            commit: first,
            path: "../outside.txt".to_owned(),
            load_large: false,
        },
    );

    assert!(matches!(result, Err(ApiError::Unexpected { .. })));
}
