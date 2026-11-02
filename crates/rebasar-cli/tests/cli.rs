mod common;

use std::process::Output;

use common::{stderr, stdout, Install};

#[test]
fn help_prints_the_same_usage_in_all_three_spellings() {
    let install = Install::without_app();

    let outputs: Vec<Output> = ["help", "--help", "-h"]
        .iter()
        .map(|spelling| install.run(&[spelling]))
        .collect();

    for output in &outputs {
        assert!(output.status.success());
        assert!(
            stdout(output).contains("Usage:"),
            "no usage: {}",
            stdout(output)
        );
        assert_eq!(stdout(output), stdout(&outputs[0]));
    }
}

#[test]
fn the_usage_lists_opening_a_path_and_nothing_that_does_not_exist() {
    let install = Install::without_app();

    let usage = stdout(&install.run(&["help"]));

    assert!(usage.contains("rebasar [path]"));
    assert!(usage.contains("rebasar help"));
    assert!(
        !usage.contains("clone"),
        "promises a command that does not exist: {usage}"
    );
}

#[test]
fn the_version_flags_print_the_workspace_version() {
    let install = Install::without_app();
    let expected = format!("rebasar {}\n", env!("CARGO_PKG_VERSION"));

    for flag in ["--version", "-V"] {
        let output = install.run(&[flag]);

        assert!(output.status.success());
        assert_eq!(stdout(&output), expected);
    }
}

#[test]
fn with_no_arguments_it_starts_the_app_beside_it_with_no_path_and_exits_at_once() {
    let install = Install::with_app();

    let output = install.run(&[]);

    assert!(output.status.success(), "stderr: {}", stderr(&output));
    assert_eq!(install.app_arguments().as_deref(), Some(""));
}

#[test]
fn a_missing_app_beside_it_is_one_line_on_stderr_and_exit_code_1() {
    let install = Install::without_app();

    let output = install.run(&[]);

    assert_eq!(output.status.code(), Some(1));
    assert_eq!(stdout(&output), "");
    assert_eq!(
        stderr(&output).lines().count(),
        1,
        "stderr: {}",
        stderr(&output)
    );
    assert!(
        stderr(&output).contains("Rebasar app"),
        "stderr: {}",
        stderr(&output)
    );
}

#[test]
fn an_unknown_option_is_rejected_and_the_app_is_not_started() {
    let install = Install::with_app();

    let output = install.run(&["--bogus"]);

    assert_eq!(output.status.code(), Some(1));
    assert!(
        stderr(&output).contains("--bogus"),
        "stderr: {}",
        stderr(&output)
    );
    assert!(install.app_was_not_started());
}
