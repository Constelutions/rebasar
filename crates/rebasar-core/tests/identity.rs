use rebasar_core::{Core, GitIdentity};
use rebasar_testkit::{IsolatedGitConfig, TempRepo};

fn identity(name: Option<&str>, email: Option<&str>) -> GitIdentity {
    GitIdentity {
        name: name.map(str::to_owned),
        email: email.map(str::to_owned),
    }
}

#[test]
fn the_identity_is_read_from_the_global_git_configuration() {
    let git = IsolatedGitConfig::new();
    git.set_global("user.name", "Ada Lovelace");
    git.set_global("user.email", "ada@example.com");

    let read = Core::new(|_| {}).git_identity().expect("identity");

    assert_eq!(
        read,
        identity(Some("Ada Lovelace"), Some("ada@example.com"))
    );
}

#[test]
fn an_identity_that_was_never_configured_reads_as_unset() {
    let _git = IsolatedGitConfig::new();

    let read = Core::new(|_| {}).git_identity().expect("identity");

    assert_eq!(read, identity(None, None));
}

#[test]
fn saving_the_identity_writes_it_through_git_config() {
    let git = IsolatedGitConfig::new();

    let saved = Core::new(|_| {})
        .set_git_identity(&identity(Some("Grace Hopper"), Some("grace@example.com")))
        .expect("save identity");

    assert_eq!(git.global("user.name").as_deref(), Some("Grace Hopper"));
    assert_eq!(
        git.global("user.email").as_deref(),
        Some("grace@example.com")
    );
    assert_eq!(
        saved,
        identity(Some("Grace Hopper"), Some("grace@example.com"))
    );
}

#[test]
fn saving_replaces_the_previous_identity_and_trims_what_was_typed() {
    let git = IsolatedGitConfig::new();
    git.set_global("user.name", "Old Name");
    git.set_global("user.email", "old@example.com");

    Core::new(|_| {})
        .set_git_identity(&identity(Some("  New Name "), Some(" new@example.com  ")))
        .expect("save identity");

    assert_eq!(git.global("user.name").as_deref(), Some("New Name"));
    assert_eq!(git.global("user.email").as_deref(), Some("new@example.com"));
}

#[test]
fn a_blank_value_removes_it_from_the_git_configuration() {
    let git = IsolatedGitConfig::new();
    git.set_global("user.name", "Ada Lovelace");
    git.set_global("user.email", "ada@example.com");

    let saved = Core::new(|_| {})
        .set_git_identity(&identity(Some("Ada Lovelace"), Some("   ")))
        .expect("save identity");

    assert_eq!(git.global("user.name").as_deref(), Some("Ada Lovelace"));
    assert_eq!(git.global("user.email"), None);
    assert_eq!(saved, identity(Some("Ada Lovelace"), None));
}

#[test]
fn clearing_a_value_that_was_never_set_is_not_an_error() {
    let git = IsolatedGitConfig::new();

    Core::new(|_| {})
        .set_git_identity(&identity(None, None))
        .expect("save identity");

    assert_eq!(git.global("user.name"), None);
}

fn repository_without_identity() -> TempRepo {
    let repo = TempRepo::init("project");
    repo.git(&["config", "--unset", "user.name"]);
    repo.git(&["config", "--unset", "user.email"]);
    repo
}

fn local(repo: &TempRepo, key: &str) -> Option<String> {
    let output = std::process::Command::new("git")
        .current_dir(repo.path())
        .args(["config", "--local", "--get", key])
        .output()
        .expect("run git");
    output
        .status
        .success()
        .then(|| String::from_utf8_lossy(&output.stdout).trim().to_owned())
}

#[test]
fn a_repository_that_sets_no_identity_reads_as_unset_whatever_the_global_one_is() {
    let git = IsolatedGitConfig::new();
    git.set_global("user.name", "Ada Lovelace");
    git.set_global("user.email", "ada@example.com");
    let repo = repository_without_identity();

    let read = Core::new(|_| {})
        .repository_git_identity(repo.path())
        .expect("identity");

    assert_eq!(read, identity(None, None));
}

#[test]
fn the_repository_identity_is_written_to_its_local_configuration_and_not_to_the_global_one() {
    let git = IsolatedGitConfig::new();
    git.set_global("user.name", "Ada Lovelace");
    git.set_global("user.email", "ada@example.com");
    let repo = repository_without_identity();

    let saved = Core::new(|_| {})
        .set_repository_git_identity(
            repo.path(),
            &identity(Some(" Grace Hopper "), Some("grace@work.example")),
        )
        .expect("save identity");

    assert_eq!(
        saved,
        identity(Some("Grace Hopper"), Some("grace@work.example"))
    );
    assert_eq!(local(&repo, "user.name").as_deref(), Some("Grace Hopper"));
    assert_eq!(
        local(&repo, "user.email").as_deref(),
        Some("grace@work.example")
    );
    assert_eq!(git.global("user.name").as_deref(), Some("Ada Lovelace"));
    assert_eq!(git.global("user.email").as_deref(), Some("ada@example.com"));
}

#[test]
fn clearing_the_repository_identity_falls_back_to_the_global_one() {
    let git = IsolatedGitConfig::new();
    git.set_global("user.name", "Ada Lovelace");
    git.set_global("user.email", "ada@example.com");
    let repo = repository_without_identity();
    let core = Core::new(|_| {});
    core.set_repository_git_identity(
        repo.path(),
        &identity(Some("Grace Hopper"), Some("grace@work.example")),
    )
    .expect("save identity");

    let cleared = core
        .set_repository_git_identity(repo.path(), &identity(None, Some("  ")))
        .expect("clear identity");

    assert_eq!(cleared, identity(None, None));
    assert_eq!(local(&repo, "user.name"), None);
    assert_eq!(local(&repo, "user.email"), None);
    assert_eq!(git.global("user.name").as_deref(), Some("Ada Lovelace"));
}

#[test]
fn the_repository_identity_applies_to_every_worktree_of_the_repository() {
    let _git = IsolatedGitConfig::new();
    let repo = repository_without_identity();
    repo.commit_file("a.txt", "a", "first");
    let linked = repo.add_worktree("linked", "feature");
    let core = Core::new(|_| {});

    core.set_repository_git_identity(
        repo.path(),
        &identity(Some("Grace Hopper"), Some("grace@work.example")),
    )
    .expect("save identity");

    assert_eq!(
        core.repository_git_identity(&linked).expect("identity"),
        identity(Some("Grace Hopper"), Some("grace@work.example"))
    );
}

#[test]
fn the_repository_identity_cannot_be_read_outside_a_repository() {
    let _git = IsolatedGitConfig::new();
    let folder = tempfile::tempdir().unwrap();

    let result = Core::new(|_| {}).repository_git_identity(folder.path());

    assert!(result.is_err());
}
