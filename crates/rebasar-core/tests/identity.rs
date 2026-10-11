use rebasar_core::{Core, GitIdentity};
use rebasar_testkit::IsolatedGitConfig;

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
