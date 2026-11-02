use rebasar_bench::{
    app_results, run, scenarios, FixtureCache, Limit, Report, Scale, Scenario, Verdict, COLD_START, THRESHOLDS,
};
use std::sync::atomic::{AtomicUsize, Ordering};

use serde_json::Value;

fn run_placeholders() -> Report {
    let dir = tempfile::tempdir().expect("create cache dir");
    let cache = FixtureCache::new(dir.path());
    run(&cache, &Scale::SMOKE, &scenarios()).expect("run benchmarks")
}

#[test]
fn the_alpha_thresholds_are_defined_in_one_place() {
    let limits: Vec<_> = THRESHOLDS
        .iter()
        .map(|threshold| (threshold.id, threshold.limit))
        .collect();

    assert_eq!(
        limits,
        [
            ("cold-start", Limit::Milliseconds(1_000)),
            ("graph", Limit::Milliseconds(2_000)),
            ("status", Limit::Milliseconds(300)),
            ("tab-switch", Limit::Milliseconds(100)),
            ("first-changeset-file", Limit::Milliseconds(300)),
            ("idle-memory", Limit::Megabytes(300)),
        ]
    );
}

#[test]
fn a_placeholder_benchmark_runs_end_to_end_through_the_core_api() {
    let report = run_placeholders();

    assert!(!report.results.is_empty());
    for result in &report.results {
        assert!(result.elapsed_ms > 0.0, "{} was not timed", result.scenario);
    }
}

#[test]
fn the_text_report_prints_each_alpha_threshold_next_to_the_scenarios() {
    let text = run_placeholders().to_string();

    assert!(text.contains("open-folder"), "{text}");
    assert!(text.contains("Tab switch"), "{text}");
    assert!(text.contains("100 ms"), "{text}");
    assert!(text.contains("300 MB"), "{text}");
    assert!(text.contains("not measured yet"), "{text}");
}

#[test]
fn the_commit_graph_is_measured_against_its_threshold_through_the_core_api() {
    let report = run_placeholders();

    let graph = report
        .thresholds
        .iter()
        .find(|threshold| threshold.id == "graph")
        .expect("graph threshold");
    assert_eq!(graph.measured_by, ["history-first-page"]);
    assert!(report
        .results
        .iter()
        .any(|result| result.scenario == "history-scroll-ten-pages"));
}

#[test]
fn the_results_are_recorded_in_a_machine_readable_form() {
    let report = run_placeholders();

    let json: Value = serde_json::from_str(&report.to_json()).expect("report is valid JSON");

    assert_eq!(
        json["scale"]["historyCommits"],
        Scale::SMOKE.history_commits
    );
    assert_eq!(
        json["results"].as_array().map(Vec::len),
        Some(report.results.len())
    );
    assert!(json["results"][0]["elapsedMs"].is_number());
    assert_eq!(
        json["thresholds"].as_array().map(Vec::len),
        Some(THRESHOLDS.len())
    );
}

#[test]
fn benchmarks_report_a_missed_threshold_without_failing_the_run() {
    let dir = tempfile::tempdir().expect("create cache dir");
    let cache = FixtureCache::new(dir.path());
    let slow = Scenario::new("sleeps-past-the-threshold", |_, _| {
        std::thread::sleep(std::time::Duration::from_millis(1_100));
        Ok(())
    })
    .against(&COLD_START);

    let report = run(&cache, &Scale::SMOKE, &[slow]).expect("a missed threshold is not an error");

    assert_eq!(report.results[0].verdict, Verdict::Exceeded);
    assert!(report.to_string().contains("exceeded"));
}

#[test]
fn a_warmed_up_scenario_runs_once_untimed_before_the_timed_run() {
    static RUNS: AtomicUsize = AtomicUsize::new(0);
    let dir = tempfile::tempdir().expect("create cache dir");
    let cache = FixtureCache::new(dir.path());
    let scenario = Scenario::new("counts-its-runs", |_, _| {
        RUNS.fetch_add(1, Ordering::SeqCst);
        Ok(())
    })
    .after_warm_up();

    run(&cache, &Scale::SMOKE, &[scenario]).expect("run benchmarks");

    assert_eq!(RUNS.load(Ordering::SeqCst), 2);
}

#[test]
fn status_is_measured_against_the_status_threshold() {
    let report = run_placeholders();

    let status = report
        .thresholds
        .iter()
        .find(|row| row.id == "status")
        .expect("status threshold");
    assert_eq!(status.measured_by, ["status-worktree"]);
}

#[test]
fn the_first_changeset_file_is_measured_by_listing_the_changes_and_diffing_the_first() {
    let report = run_placeholders();

    let first_file = report
        .thresholds
        .iter()
        .find(|row| row.id == "first-changeset-file")
        .expect("first-changeset-file threshold");
    assert_eq!(first_file.measured_by, ["first-changeset-file"]);
}

fn tabs_result(report: &Report) -> &rebasar_bench::ScenarioResult {
    report
        .results
        .iter()
        .find(|result| result.scenario == "tabs-at-scale")
        .expect("the tabs-at-scale scenario")
}

#[test]
fn the_tabs_scenario_records_cpu_memory_and_tab_switch_time() {
    let report = run_placeholders();

    let names: Vec<_> = tabs_result(&report)
        .measurements
        .iter()
        .map(|measurement| measurement.name.as_str())
        .collect();

    for expected in [
        "tabs-open",
        "memory-after-open-mb",
        "memory-after-switching-mb",
        "cpu-while-opening-ms",
        "cpu-while-idle-percent",
        "tab-switch-median-ms",
        "tab-switch-max-ms",
    ] {
        assert!(
            names.contains(&expected),
            "{expected} missing from {names:?}"
        );
    }
}

#[test]
fn the_tabs_scenario_opens_every_worktree_of_the_fixture() {
    let report = run_placeholders();

    let open = tabs_result(&report)
        .measurements
        .iter()
        .find(|measurement| measurement.name == "tabs-open")
        .expect("tabs-open");

    assert_eq!(open.value, Scale::SMOKE.tab_worktrees as f64);
}

#[test]
fn the_slowest_tab_switch_is_measured_against_the_tab_switch_threshold() {
    let report = run_placeholders();

    let tab_switch = report
        .thresholds
        .iter()
        .find(|row| row.id == "tab-switch")
        .expect("tab-switch threshold");
    assert_eq!(tab_switch.measured_by, ["tabs-at-scale"]);
    let result = tabs_result(&report);
    let max = result
        .measurements
        .iter()
        .find(|measurement| measurement.name == "tab-switch-max-ms")
        .expect("tab-switch-max-ms");
    assert_eq!(result.elapsed_ms, max.value);
}

#[test]
fn the_text_report_lists_the_measurements_of_a_scenario() {
    let text = run_placeholders().to_string();

    assert!(text.contains("tab-switch-max-ms"), "{text}");
    assert!(text.contains("memory-after-open-mb"), "{text}");
}

#[test]
fn the_apps_cold_start_and_idle_memory_are_checked_against_their_thresholds() {
    let within = app_results(r#"{ "coldStartMs": 640.5, "idleMemoryMb": 212.0 }"#).unwrap();
    let missed = app_results(r#"{ "coldStartMs": 1480.0, "idleMemoryMb": 410.5 }"#).unwrap();

    let summary = |results: &[rebasar_bench::ScenarioResult]| {
        results
            .iter()
            .map(|result| (result.scenario.clone(), result.threshold, result.verdict))
            .collect::<Vec<_>>()
    };
    assert_eq!(
        summary(&within),
        [
            ("app-cold-start".to_owned(), Some("cold-start"), Verdict::Within),
            ("app-idle-memory".to_owned(), Some("idle-memory"), Verdict::Within),
        ]
    );
    assert_eq!(missed[0].verdict, Verdict::Exceeded);
    assert_eq!(missed[1].verdict, Verdict::Exceeded);
    assert_eq!(missed[1].measurements[0].value, 410.5);
}

#[test]
fn a_report_with_the_apps_figures_measures_every_threshold() {
    let mut results = run_placeholders().results;
    results.extend(app_results(r#"{ "coldStartMs": 700, "idleMemoryMb": 150 }"#).unwrap());

    let report = Report::new(Scale::SMOKE, results);

    for row in &report.thresholds {
        assert!(!row.measured_by.is_empty(), "{} is not measured", row.id);
    }
}

#[test]
fn unreadable_app_results_are_an_error() {
    assert!(app_results("not json").is_err());
    assert!(app_results(r#"{ "coldStartMs": 1 }"#).is_err());
}

#[test]
fn the_cold_start_keeps_the_driver_inclusive_figure_as_a_ceiling_when_the_app_reports_it() {
    let with_driver = app_results(
        r#"{ "coldStartMs": 580, "coldStartWithDriverMs": 1052, "idleMemoryMb": 150 }"#,
    )
    .unwrap();
    let without_driver = app_results(r#"{ "coldStartMs": 580, "idleMemoryMb": 150 }"#).unwrap();

    assert_eq!(with_driver[0].elapsed_ms, 580.0);
    assert_eq!(with_driver[0].verdict, Verdict::Within);
    assert_eq!(with_driver[0].measurements.len(), 1);
    assert_eq!(with_driver[0].measurements[0].name, "cold-start-with-driver-ms");
    assert_eq!(with_driver[0].measurements[0].value, 1052.0);
    assert!(without_driver[0].measurements.is_empty());
}
