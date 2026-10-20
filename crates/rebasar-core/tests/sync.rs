use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use rebasar_core::{
    ApiError, Assessment, Core, MutationKind, MutationOutcome, PullStrategy, SyncStatus,
};
use rebasar_testkit::{IsolatedGitConfig, TempRepo};

/// Someone else working on the same remote.
struct Colleague {
    _root: tempfile::TempDir,
    path: PathBuf,
}

impl Colleague {
    fn clone_of(repo: &TempRepo) -> Self {
        let root = tempfile::tempdir().expect("temp dir");
        let path = root.path().join("colleague");
        let url = repo.git(&["remote", "get-url", "origin"]);
        run(root.path(), &["clone", url.trim(), "colleague"]);
        Self { _root: root, path }
    }

    fn commit(&self, file: &str, contents: &str, message: &str) {
        fs::write(self.path.join(file), contents).expect("write");
        run(&self.path, &["add", file]);
        run(
            &self.path,
            &["-c", "user.name=Colleague", "-c", "user.email=c@example.com", "commit", "-m", message],
        );
    }

    fn push(&self) {
        run(&self.path, &["push", "origin", "HEAD"]);
    }

    fn force_push(&self) {
        run(&self.path, &["push", "--force", "origin", "HEAD"]);
    }
}

fn run(folder: &Path, args: &[&str]) {
    let output = Command::new("git")
        .args(args)
        .current_dir(folder)
        .output()
        .expect("run git");
    assert!(
        output.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
}

fn tracked_repository() -> TempRepo {
    let repo = TempRepo::init("sample");
    repo.add_bare_remote("origin");
    repo.commit_file("a.txt", "one\n", "Initial commit");
    repo.git(&["push", "--set-upstream", "origin", "main"]);
    repo
}

fn status(repo: &TempRepo) -> SyncStatus {
    Core::new(|_| {}).sync_status(repo.path()).expect("sync status")
}

fn ok(outcome: Result<MutationOutcome, ApiError>) {
    assert_eq!(outcome.expect("runs"), MutationOutcome::Succeeded);
}

#[test]
fn a_branch_level_with_its_upstream_is_neither_ahead_nor_behind() {
    let repo = tracked_repository();

    assert_eq!(
        status(&repo),
        SyncStatus {
            branch: Some("main".to_owned()),
            upstream: Some("origin/main".to_owned()),
            ahead: 0,
            behind: 0,
        }
    );
}

#[test]
fn local_commits_count_as_ahead_and_fetched_ones_as_behind() {
    let repo = tracked_repository();
    repo.commit_file("b.txt", "local\n", "Local work");
    let colleague = Colleague::clone_of(&repo);
    colleague.commit("c.txt", "remote\n", "Remote one");
    colleague.commit("d.txt", "remote\n", "Remote two");
    colleague.push();
    let core = Core::new(|_| {});
    assert_eq!(core.sync_status(repo.path()).unwrap().behind, 0, "unknown until fetched");

    ok(core.fetch(repo.path()));

    let status = status(&repo);
    assert_eq!((status.ahead, status.behind), (1, 2));
}

#[test]
fn a_branch_that_was_never_pushed_has_no_upstream_and_everything_is_ahead() {
    let repo = TempRepo::init("sample");
    repo.add_bare_remote("origin");
    repo.commit_file("a.txt", "one\n", "Initial commit");
    repo.commit_file("b.txt", "two\n", "Second");

    let status = status(&repo);

    assert_eq!(status.upstream, None);
    assert_eq!(status.ahead, 2);
}

#[test]
fn a_detached_head_has_nothing_to_sync() {
    let repo = tracked_repository();
    repo.detach_head();

    let status = status(&repo);

    assert_eq!((status.branch, status.upstream, status.ahead, status.behind), (None, None, 0, 0));
}

#[test]
fn pushing_publishes_the_local_commits() {
    let repo = tracked_repository();
    repo.commit_file("b.txt", "local\n", "Local work");
    let core = Core::new(|_| {});

    ok(core.push(repo.path(), false));

    assert_eq!(status(&repo).ahead, 0);
    let colleague = Colleague::clone_of(&repo);
    assert!(colleague.path.join("b.txt").exists());
}

#[test]
fn pushing_a_new_branch_publishes_it_and_sets_its_upstream() {
    let repo = tracked_repository();
    repo.create_branch("topic");
    repo.commit_file("b.txt", "topic\n", "Topic work");

    ok(Core::new(|_| {}).push(repo.path(), false));

    let status = status(&repo);
    assert_eq!(status.upstream.as_deref(), Some("origin/topic"));
    assert_eq!(status.ahead, 0);
}

#[test]
fn pushing_without_any_remote_is_an_error() {
    let repo = TempRepo::init("sample");
    repo.commit_file("a.txt", "one\n", "Initial commit");

    assert!(Core::new(|_| {}).push(repo.path(), false).is_err());
}

#[test]
fn a_plain_push_of_a_diverged_branch_is_rejected_and_changes_nothing_remotely() {
    let repo = tracked_repository();
    let colleague = Colleague::clone_of(&repo);
    colleague.commit("c.txt", "remote\n", "Remote work");
    colleague.push();
    repo.commit_file("b.txt", "local\n", "Local work");
    let core = Core::new(|_| {});
    ok(core.fetch(repo.path()));

    let outcome = core.push(repo.path(), false).unwrap();

    assert!(matches!(outcome, MutationOutcome::Failed { .. }));
    assert_eq!(status(&repo).behind, 1);
}

#[test]
fn a_forced_push_overwrites_the_remote_when_the_lease_still_holds() {
    let repo = tracked_repository();
    let colleague = Colleague::clone_of(&repo);
    colleague.commit("c.txt", "remote\n", "Remote work");
    colleague.push();
    repo.commit_file("b.txt", "local\n", "Local work");
    let core = Core::new(|_| {});
    ok(core.fetch(repo.path()));

    ok(core.push(repo.path(), true));

    let status = status(&repo);
    assert_eq!((status.ahead, status.behind), (0, 0));
}

#[test]
fn a_forced_push_refuses_to_overwrite_commits_it_has_not_seen() {
    let repo = tracked_repository();
    repo.commit_file("b.txt", "local\n", "Local work");
    let colleague = Colleague::clone_of(&repo);
    colleague.commit("c.txt", "remote\n", "Pushed after the last fetch");
    colleague.push();

    let outcome = Core::new(|_| {}).push(repo.path(), true).unwrap();

    assert!(matches!(outcome, MutationOutcome::Failed { .. }));
    let remote_log = repo.git(&["ls-remote", "origin", "main"]);
    assert!(!remote_log.contains(repo.head_commit().as_str()));
}

#[test]
fn a_forced_push_is_destructive_only_when_the_remote_has_commits_the_branch_lacks() {
    let repo = tracked_repository();
    let core = Core::new(|_| {});
    assert_eq!(
        core.assess_mutation(repo.path(), &MutationKind::ForcePush).unwrap(),
        Assessment::Safe
    );

    let colleague = Colleague::clone_of(&repo);
    colleague.commit("c.txt", "remote\n", "Remote one");
    colleague.commit("d.txt", "remote\n", "Remote two");
    colleague.push();
    repo.commit_file("b.txt", "local\n", "Local work");
    ok(core.fetch(repo.path()));

    let Assessment::Destructive { loss } = core
        .assess_mutation(repo.path(), &MutationKind::ForcePush)
        .unwrap()
    else {
        panic!("overwriting two remote commits loses work");
    };
    assert_eq!(loss.commits, 2);
}

#[test]
fn pulling_fast_forwards_when_only_the_remote_moved() {
    // The developer's own pull settings must not decide what these tests see.
    let _config = IsolatedGitConfig::new();
    let repo = tracked_repository();
    let colleague = Colleague::clone_of(&repo);
    colleague.commit("c.txt", "remote\n", "Remote work");
    colleague.push();
    let core = Core::new(|_| {});
    ok(core.fetch(repo.path()));
    assert!(!core.pull_needs_strategy(repo.path()).unwrap());

    ok(core.pull(repo.path(), None, false));

    assert!(repo.path().join("c.txt").exists());
}

#[test]
fn a_diverged_branch_needs_a_strategy_until_the_user_configured_one() {
    // The developer's own pull settings must not decide what these tests see.
    let _config = IsolatedGitConfig::new();
    let repo = tracked_repository();
    let colleague = Colleague::clone_of(&repo);
    colleague.commit("c.txt", "remote\n", "Remote work");
    colleague.push();
    repo.commit_file("b.txt", "local\n", "Local work");
    let core = Core::new(|_| {});
    ok(core.fetch(repo.path()));

    assert!(core.pull_needs_strategy(repo.path()).unwrap());
    assert!(core.pull(repo.path(), None, false).is_err());

    repo.git(&["config", "pull.rebase", "false"]);
    assert!(!core.pull_needs_strategy(repo.path()).unwrap());
    ok(core.pull(repo.path(), None, false));
    assert!(repo.path().join("c.txt").exists());
}

#[test]
fn a_pull_follows_pull_ff_too() {
    // The developer's own pull settings must not decide what these tests see.
    let _config = IsolatedGitConfig::new();
    let repo = tracked_repository();
    let colleague = Colleague::clone_of(&repo);
    colleague.commit("c.txt", "remote\n", "Remote work");
    colleague.push();
    repo.commit_file("b.txt", "local\n", "Local work");
    let core = Core::new(|_| {});
    ok(core.fetch(repo.path()));

    repo.git(&["config", "pull.ff", "only"]);

    assert!(!core.pull_needs_strategy(repo.path()).unwrap());
}

#[test]
fn pulling_with_rebase_replays_local_commits_on_top() {
    // The developer's own pull settings must not decide what these tests see.
    let _config = IsolatedGitConfig::new();
    let repo = tracked_repository();
    let colleague = Colleague::clone_of(&repo);
    colleague.commit("c.txt", "remote\n", "Remote work");
    colleague.push();
    repo.commit_file("b.txt", "local\n", "Local work");
    let core = Core::new(|_| {});
    ok(core.fetch(repo.path()));

    ok(core.pull(repo.path(), Some(PullStrategy::Rebase), false));

    assert_eq!(repo.git(&["log", "--format=%s"]).lines().collect::<Vec<_>>(), ["Local work", "Remote work", "Initial commit"]);
    repo.git_fails(&["config", "--local", "--get", "pull.rebase"]);
}

#[test]
fn pulling_with_merge_creates_a_merge_commit() {
    // The developer's own pull settings must not decide what these tests see.
    let _config = IsolatedGitConfig::new();
    let repo = tracked_repository();
    let colleague = Colleague::clone_of(&repo);
    colleague.commit("c.txt", "remote\n", "Remote work");
    colleague.push();
    repo.commit_file("b.txt", "local\n", "Local work");
    let core = Core::new(|_| {});
    ok(core.fetch(repo.path()));

    ok(core.pull(repo.path(), Some(PullStrategy::Merge), false));

    let parents = repo.git(&["rev-list", "--parents", "-n", "1", "HEAD"]);
    assert_eq!(parents.split_whitespace().count(), 3);
}

#[test]
fn a_remembered_strategy_is_saved_for_the_repository_and_stops_the_question() {
    // The developer's own pull settings must not decide what these tests see.
    let _config = IsolatedGitConfig::new();
    let repo = tracked_repository();
    let colleague = Colleague::clone_of(&repo);
    colleague.commit("c.txt", "remote\n", "Remote work");
    colleague.push();
    repo.commit_file("b.txt", "local\n", "Local work");
    let core = Core::new(|_| {});
    ok(core.fetch(repo.path()));

    ok(core.pull(repo.path(), Some(PullStrategy::Rebase), true));

    assert_eq!(repo.git(&["config", "--local", "--get", "pull.rebase"]).trim(), "true");
    assert!(!core.pull_needs_strategy(repo.path()).unwrap());
}

#[test]
fn fetching_a_remote_that_cannot_be_reached_fails_instead_of_hanging() {
    let repo = TempRepo::init("sample");
    repo.commit_file("a.txt", "one\n", "Initial commit");
    repo.git(&["remote", "add", "origin", "https://127.0.0.1:1/nothing.git"]);

    let outcome = Core::new(|_| {}).fetch(repo.path());

    assert!(
        matches!(outcome, Ok(MutationOutcome::Failed { .. }) | Err(ApiError::GitFailed { .. })),
        "{outcome:?}"
    );
}

#[test]
fn a_refused_credential_becomes_a_message_with_next_steps() {
    let repo = tracked_repository();
    repo.commit_file("b.txt", "local\n", "Local work");
    repo.install_hook(
        "pre-push",
        "echo 'fatal: Authentication failed for origin' >&2\nexit 1",
    );

    let outcome = Core::new(|_| {}).push(repo.path(), false);

    let Err(ApiError::GitFailed { message }) = outcome else {
        panic!("expected a credentials message, got {outcome:?}");
    };
    assert!(message.contains("Credential Manager"));
}
