use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};

use rebasar_bench::FixtureCache;
use serde_json::Value;

fn bench(cache_dir: &Path, args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_rebasar-bench"))
        .args(args)
        .env("REBASAR_FIXTURE_DIR", cache_dir)
        .output()
        .expect("run rebasar-bench")
}

fn stdout(output: &Output) -> String {
    String::from_utf8_lossy(&output.stdout).into_owned()
}

fn lookup<'a>(vars: &'a [(&str, &str)]) -> impl Fn(&str) -> Option<OsString> + 'a {
    move |name| {
        vars.iter()
            .find(|(key, _)| *key == name)
            .map(|(_, value)| OsString::from(value))
    }
}

#[test]
fn the_fixture_folder_can_be_chosen_with_an_environment_variable() {
    let vars = [
        ("REBASAR_FIXTURE_DIR", "D:\\fixtures"),
        ("LOCALAPPDATA", "C:\\Users\\dev"),
    ];

    assert_eq!(
        FixtureCache::location_from(lookup(&vars)),
        Some(PathBuf::from("D:\\fixtures"))
    );
}

#[test]
fn fixtures_default_to_the_user_cache_folder_and_never_the_source_tree() {
    let windows = [("LOCALAPPDATA", "C:\\Users\\dev\\AppData\\Local")];
    let linux = [("XDG_CACHE_HOME", "/home/dev/.cache")];
    let linux_without_xdg = [("HOME", "/home/dev")];

    assert_eq!(
        FixtureCache::location_from(lookup(&windows)),
        Some(
            Path::new("C:\\Users\\dev\\AppData\\Local")
                .join("rebasar")
                .join("fixtures")
        )
    );
    assert_eq!(
        FixtureCache::location_from(lookup(&linux)),
        Some(
            Path::new("/home/dev/.cache")
                .join("rebasar")
                .join("fixtures")
        )
    );
    assert_eq!(
        FixtureCache::location_from(lookup(&linux_without_xdg)),
        Some(
            Path::new("/home/dev")
                .join(".cache")
                .join("rebasar")
                .join("fixtures")
        )
    );
    assert_eq!(FixtureCache::location_from(lookup(&[])), None);
}

#[test]
fn the_generate_command_builds_the_fixtures_in_the_cache_folder() {
    let cache_dir = tempfile::tempdir().expect("create cache dir");

    let output = bench(cache_dir.path(), &["generate", "--scale", "smoke"]);

    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let built = std::fs::read_dir(cache_dir.path())
        .expect("list cache")
        .count();
    assert_eq!(built, 4, "history, worktree, changeset and tabs");
}

#[test]
fn the_run_command_prints_a_report_and_records_it_as_json() {
    let cache_dir = tempfile::tempdir().expect("create cache dir");
    let results = cache_dir.path().join("results.json");

    let output = bench(
        cache_dir.path(),
        &[
            "run",
            "--scale",
            "smoke",
            "--output",
            results.to_str().expect("utf-8 path"),
        ],
    );

    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(stdout(&output).contains("Alpha thresholds"));
    let recorded: Value =
        serde_json::from_str(&std::fs::read_to_string(&results).expect("results file"))
            .expect("results are JSON");
    assert!(recorded["results"]
        .as_array()
        .is_some_and(|results| !results.is_empty()));
}

#[test]
fn an_unknown_command_fails_with_usage() {
    let cache_dir = tempfile::tempdir().expect("create cache dir");

    let output = bench(cache_dir.path(), &["frobnicate"]);

    assert!(!output.status.success());
    assert!(String::from_utf8_lossy(&output.stderr).contains("usage"));
}
