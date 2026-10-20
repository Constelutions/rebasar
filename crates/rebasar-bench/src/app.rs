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
    /// From launching the app until its first click is answered.
    cold_start_ms: f64,
    /// The working sets of the app and every process it started, after it sat idle.
    idle_memory_mb: f64,
}

/// The measured scenarios for the app, ready to join a report.
pub fn app_results(json: &str) -> Result<Vec<ScenarioResult>, String> {
    let measured: AppMeasurements =
        serde_json::from_str(json).map_err(|error| format!("unreadable app results: {error}"))?;

    let memory = vec![Measurement {
        name: "app-memory".to_owned(),
        value: measured.idle_memory_mb,
        unit: "MB",
    }];
    Ok(vec![
        ScenarioResult {
            scenario: "app-cold-start".to_owned(),
            elapsed_ms: measured.cold_start_ms,
            threshold: Some(COLD_START.id),
            verdict: verdict(measured.cold_start_ms, &[], Some(&COLD_START)),
            measurements: Vec::new(),
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
