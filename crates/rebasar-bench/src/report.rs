use std::fmt;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;

use crate::fixtures::Scale;
use crate::thresholds::{Limit, THRESHOLDS};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Verdict {
    Within,
    Exceeded,
    /// No time threshold to compare against.
    Unchecked,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Measurement {
    pub name: String,
    pub value: f64,
    pub unit: &'static str,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScenarioResult {
    pub scenario: String,
    pub elapsed_ms: f64,
    pub threshold: Option<&'static str>,
    pub verdict: Verdict,
    /// Figures beyond the elapsed time, such as memory and CPU.
    pub measurements: Vec<Measurement>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThresholdRow {
    pub id: &'static str,
    pub description: &'static str,
    pub limit: Limit,
    pub measured_by: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub recorded_at_unix: u64,
    pub scale: Scale,
    pub results: Vec<ScenarioResult>,
    pub thresholds: Vec<ThresholdRow>,
}

impl Report {
    pub fn new(scale: Scale, results: Vec<ScenarioResult>) -> Self {
        let thresholds = THRESHOLDS
            .iter()
            .map(|threshold| ThresholdRow {
                id: threshold.id,
                description: threshold.description,
                limit: threshold.limit,
                measured_by: results
                    .iter()
                    .filter(|result| result.threshold == Some(threshold.id))
                    .map(|result| result.scenario.clone())
                    .collect(),
            })
            .collect();
        let recorded_at_unix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |since_epoch| since_epoch.as_secs());
        Self {
            recorded_at_unix,
            scale,
            results,
            thresholds,
        }
    }

    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).expect("a report always serialises")
    }
}

impl fmt::Display for Report {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        writeln!(f, "Scenarios")?;
        for result in &self.results {
            let verdict = match (result.verdict, result.threshold) {
                (Verdict::Within, Some(id)) => format!("within {id}"),
                (Verdict::Exceeded, Some(id)) => format!("exceeded {id}"),
                _ => "no threshold".to_owned(),
            };
            writeln!(
                f,
                "  {:<28} {:>10.1} ms   {verdict}",
                result.scenario, result.elapsed_ms
            )?;
            for measurement in &result.measurements {
                writeln!(
                    f,
                    "    {:<30} {:>10.1} {}",
                    measurement.name, measurement.value, measurement.unit
                )?;
            }
        }
        writeln!(f)?;
        writeln!(f, "Alpha thresholds")?;
        for row in &self.thresholds {
            let measured = match row.measured_by.is_empty() {
                true => "not measured yet".to_owned(),
                false => format!("measured by {}", row.measured_by.join(", ")),
            };
            writeln!(
                f,
                "  {:<62} < {:<8} {measured}",
                row.description,
                row.limit.to_string()
            )?;
        }
        Ok(())
    }
}
