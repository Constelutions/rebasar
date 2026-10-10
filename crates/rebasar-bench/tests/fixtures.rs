use std::path::Path;

use rebasar_bench::{FixtureCache, Scale};
use rebasar_core::platform::git_command;
use tempfile::TempDir;

const SMALL: Scale = Scale {
    history_commits: 400,
    worktree_files: 120,
    changeset_files: 30,
    changeset_changed_lines: 600,
};

fn cache() -> (TempDir, FixtureCache) {
    let dir = tempfile::tempdir().expect("create cache dir");
    let cache = FixtureCache::new(dir.path());
    (dir, cache)
}

fn git(repo: &Path, args: &[&str]) -> String {
    let output = git_command()
        .args(args)
        .current_dir(repo)
        .output()
        .expect("run git");
    assert!(
        output.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8_lossy(&output.stdout).into_owned()
}

fn count_lines(output: &str) -> usize {
    output.lines().count()
}

#[test]
fn history_fixture_has_the_requested_number_of_commits_with_branches_and_merges() {
    let (_dir, cache) = cache();

    let repo = cache.history(&SMALL).expect("generate history");

    let reachable = git(&repo, &["rev-list", "--all", "--count"]);
    assert_eq!(reachable.trim(), SMALL.history_commits.to_string());
    let merges = git(&repo, &["rev-list", "--all", "--merges"]);
    assert!(
        count_lines(&merges) >= 10,
        "expected merges, got {merges:?}"
    );
    let branches = git(&repo, &["for-each-ref", "refs/heads"]);
    assert!(count_lines(&branches) >= 2, "expected several branches");
    assert_eq!(git(&repo, &["status", "--porcelain"]).trim(), "");
}

#[test]
fn worktree_fixture_is_a_clean_checkout_of_the_requested_number_of_files() {
    let (_dir, cache) = cache();

    let repo = cache.worktree(&SMALL).expect("generate worktree");

    let tracked = git(&repo, &["ls-files"]);
    assert_eq!(count_lines(&tracked), SMALL.worktree_files);
    let first_on_disk = repo.join(tracked.lines().next().expect("a tracked file"));
    assert!(first_on_disk.is_file(), "files are checked out");
    assert_eq!(git(&repo, &["status", "--porcelain"]).trim(), "");
}

#[test]
fn changeset_fixture_leaves_the_requested_files_and_lines_changed_in_the_worktree() {
    let (_dir, cache) = cache();

    let repo = cache.changeset(&SMALL).expect("generate changeset");

    let numstat = git(&repo, &["diff", "--numstat"]);
    let changed_files = count_lines(&numstat);
    let changed_lines: usize = numstat
        .lines()
        .flat_map(|line| line.split('\t').take(2))
        .map(|count| count.parse::<usize>().expect("numeric line count"))
        .sum();
    assert_eq!(changed_files, SMALL.changeset_files);
    assert_eq!(changed_lines, SMALL.changeset_changed_lines);
    assert_eq!(git(&repo, &["diff", "--cached", "--numstat"]).trim(), "");
}

#[test]
fn fixtures_are_generated_once_and_reused() {
    let (_dir, cache) = cache();
    let repo = cache.worktree(&SMALL).expect("generate worktree");
    std::fs::write(repo.join("sentinel"), "left by the first run").expect("write sentinel");

    let again = cache.worktree(&SMALL).expect("reuse worktree");

    assert_eq!(again, repo);
    assert!(again.join("sentinel").exists(), "was regenerated");
}

#[test]
fn an_interrupted_generation_is_discarded_rather_than_reused() {
    let (dir, cache) = cache();
    let half_built = dir.path().join("worktree-120-files.partial");
    std::fs::create_dir_all(&half_built).expect("create half-built fixture");
    std::fs::write(half_built.join("stale"), "").expect("write stale file");

    let repo = cache.worktree(&SMALL).expect("generate worktree");

    assert!(!repo.join("stale").exists());
    assert!(!half_built.exists());
}
