mod app;
mod fixtures;
mod report;
mod runner;
mod tabs;
mod thresholds;

pub use app::app_results;
pub use fixtures::{FixtureCache, Scale};
pub use report::{Measurement, Report, ScenarioResult, ThresholdRow, Verdict};
pub use runner::{run, scenarios, Fixtures, Measured, Scenario};
pub use thresholds::{
    Limit, Threshold, COLD_START, FIRST_CHANGESET_FILE, GRAPH, IDLE_MEMORY, STATUS, TAB_SWITCH,
    THRESHOLDS,
};
