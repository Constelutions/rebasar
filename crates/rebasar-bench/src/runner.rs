use std::io;
use std::path::PathBuf;
use std::time::Instant;

use rebasar_core::{ApiError, Core};

use crate::fixtures::{FixtureCache, Scale};
use crate::report::{Report, ScenarioResult, Verdict};
use crate::thresholds::{Limit, Threshold, STATUS};

pub struct Fixtures {
    pub history: PathBuf,
    pub worktree: PathBuf,
    pub changeset: PathBuf,
}

type Action = fn(&Core, &Fixtures) -> Result<(), ApiError>;

pub struct Scenario {
    name: &'static str,
    action: Action,
    threshold: Option<&'static Threshold>,
    warm_up: bool,
}

impl Scenario {
    pub fn new(name: &'static str, action: Action) -> Self {
        Self {
            name,
            action,
            threshold: None,
            warm_up: false,
        }
    }

    /// Runs the action once untimed first, for operations the app repeats on a warm file cache.
    pub fn after_warm_up(mut self) -> Self {
        self.warm_up = true;
        self
    }

    pub fn against(mut self, threshold: &'static Threshold) -> Self {
        self.threshold = Some(threshold);
        self
    }
}

/// The `open-folder-*` placeholders exercise the whole pipeline; later tickets add the scenarios
/// that map to each threshold.
pub fn scenarios() -> Vec<Scenario> {
    vec![
        Scenario::new("open-folder-history", |core, fixtures| {
            core.open_folder(&fixtures.history).map(drop)
        }),
        Scenario::new("open-folder-worktree", |core, fixtures| {
            core.open_folder(&fixtures.worktree).map(drop)
        }),
        Scenario::new("open-folder-changeset", |core, fixtures| {
            core.open_folder(&fixtures.changeset).map(drop)
        }),
        Scenario::new("status-worktree", |core, fixtures| {
            core.worktree_status(&fixtures.worktree).map(drop)
        })
        .after_warm_up()
        .against(&STATUS),
        Scenario::new("status-changeset", |core, fixtures| {
            core.worktree_status(&fixtures.changeset).map(drop)
        })
        .after_warm_up(),
    ]
}

/// Times every scenario and reports against the thresholds; a missed threshold is reported,
/// never an error.
pub fn run(cache: &FixtureCache, scale: &Scale, scenarios: &[Scenario]) -> io::Result<Report> {
    let fixtures = Fixtures {
        history: cache.history(scale)?,
        worktree: cache.worktree(scale)?,
        changeset: cache.changeset(scale)?,
    };
    let core = Core::new(|_| {});

    let mut results = Vec::new();
    for scenario in scenarios {
        let fail = |error: ApiError| io::Error::other(format!("{}: {error}", scenario.name));
        if scenario.warm_up {
            (scenario.action)(&core, &fixtures).map_err(fail)?;
        }
        let started = Instant::now();
        (scenario.action)(&core, &fixtures).map_err(fail)?;
        let elapsed_ms = started.elapsed().as_secs_f64() * 1000.0;
        results.push(ScenarioResult {
            scenario: scenario.name.to_owned(),
            elapsed_ms,
            threshold: scenario.threshold.map(|threshold| threshold.id),
            verdict: verdict(elapsed_ms, scenario.threshold),
        });
    }
    Ok(Report::new(*scale, results))
}

fn verdict(elapsed_ms: f64, threshold: Option<&Threshold>) -> Verdict {
    match threshold.map(|threshold| threshold.limit) {
        Some(Limit::Milliseconds(limit)) if elapsed_ms <= limit as f64 => Verdict::Within,
        Some(Limit::Milliseconds(_)) => Verdict::Exceeded,
        Some(Limit::Megabytes(_)) | None => Verdict::Unchecked,
    }
}
