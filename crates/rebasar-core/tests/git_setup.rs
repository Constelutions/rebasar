use rebasar_core::{Core, GitSetup, GitVersion, MINIMUM_GIT_VERSION};

fn version(major: u32, minor: u32, patch: u32) -> GitVersion {
    GitVersion {
        major,
        minor,
        patch,
    }
}

#[test]
fn the_system_git_on_the_test_machine_is_supported() {
    assert!(matches!(
        Core::new(|_| {}).check_git(),
        GitSetup::Ready { .. }
    ));
}

#[test]
fn a_git_at_the_minimum_version_is_ready() {
    let output = format!("git version {MINIMUM_GIT_VERSION}\n");

    assert_eq!(
        GitSetup::from_version_output(Some(&output)),
        GitSetup::Ready {
            version: MINIMUM_GIT_VERSION
        }
    );
}

#[test]
fn a_git_for_windows_version_string_is_understood() {
    assert_eq!(
        GitSetup::from_version_output(Some("git version 2.47.1.windows.2\n")),
        GitSetup::Ready {
            version: version(2, 47, 1)
        }
    );
}

#[test]
fn a_git_older_than_the_minimum_is_too_old() {
    assert_eq!(
        GitSetup::from_version_output(Some("git version 2.34.9\n")),
        GitSetup::TooOld {
            version: version(2, 34, 9),
            minimum: MINIMUM_GIT_VERSION
        }
    );
}

#[test]
fn a_version_without_a_patch_number_compares_as_patch_zero() {
    assert_eq!(
        GitSetup::from_version_output(Some("git version 3.0\n")),
        GitSetup::Ready {
            version: version(3, 0, 0)
        }
    );
}

#[test]
fn a_git_that_cannot_be_run_is_missing() {
    assert_eq!(
        GitSetup::from_version_output(None),
        GitSetup::Missing {
            minimum: MINIMUM_GIT_VERSION
        }
    );
}

#[test]
fn something_that_is_not_git_is_missing() {
    assert_eq!(
        GitSetup::from_version_output(Some("hello\n")),
        GitSetup::Missing {
            minimum: MINIMUM_GIT_VERSION
        }
    );
}
