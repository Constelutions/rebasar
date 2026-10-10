use rebasar_bench::{
    run, scenarios, FixtureCache, Limit, Report, Scale, Scenario, Verdict, COLD_START, THRESHOLDS,
};
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
