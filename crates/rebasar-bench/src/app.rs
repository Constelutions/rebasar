//! The two thresholds only the running app can answer: cold start and idle memory. They are
//! measured by `e2e/app-benchmark.mjs`, which drives the real app, and read back from the file
//! it writes.

use serde::Deserialize;

use crate::report::{Measurement, ScenarioResult};
use crate::runner::verdict;
use crate::thresholds::{COLD_START, IDLE_MEMORY};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AppMeasurements {
    /// From the app's process starting until it first became interactive.
    cold_start_ms: f64,
    /// From launching the app until the WebDriver's first click is answered: the figure above
    /// plus the time the driver takes to attach, so a ceiling. Absent from older results files.
    cold_start_with_driver_ms: Option<f64>,
    /// The private working sets of the app and every process it started, after it sat idle:
    /// the memory they hold that no other process shares.
    idle_memory_mb: f64,
    /// The plain sum of their working sets, which counts every shared page once per process, so
    /// a ceiling. Absent from older results files.
    idle_working_set_mb: Option<f64>,
}

/// The measured scenarios for the app, ready to join a report.
pub fn app_results(json: &str) -> Result<Vec<ScenarioResult>, String> {
    let measured: AppMeasurements =
        serde_json::from_str(json).map_err(|error| format!("unreadable app results: {error}"))?;

    let cold_start: Vec<Measurement> = measured
        .cold_start_with_driver_ms
        .map(|value| Measurement {
            name: "cold-start-with-driver-ms".to_owned(),
            value,
            unit: "ms",
        })
        .into_iter()
        .collect();
    let memory: Vec<Measurement> = [
        ("app-memory", Some(measured.idle_memory_mb)),
        ("app-memory-working-set", measured.idle_working_set_mb),
    ]
    .into_iter()
    .filter_map(|(name, value)| {
        value.map(|value| Measurement {
            name: name.to_owned(),
            value,
            unit: "MB",
        })
    })
    .collect();
    Ok(vec![
        ScenarioResult {
            scenario: "app-cold-start".to_owned(),
            elapsed_ms: measured.cold_start_ms,
            threshold: Some(COLD_START.id),
            verdict: verdict(measured.cold_start_ms, &cold_start, Some(&COLD_START)),
            measurements: cold_start,
        },
        ScenarioResult {
            scenario: "app-idle-memory".to_owned(),
            elapsed_ms: 0.0,
            threshold: Some(IDLE_MEMORY.id),
            verdict: verdict(0.0, &memory, Some(&IDLE_MEMORY)),
            measurements: memory,
        },
    ])
}
