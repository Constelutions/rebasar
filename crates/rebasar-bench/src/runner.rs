use std::io;
use std::path::PathBuf;
use std::time::Instant;

use rebasar_core::{ApiError, ChangeList, Core, DiffRequest, HistoryFilter};

use crate::fixtures::{FixtureCache, Scale};
use crate::report::{Measurement, Report, ScenarioResult, Verdict};
use crate::tabs;
use crate::thresholds::{Limit, Threshold, FIRST_CHANGESET_FILE, GRAPH, STATUS, TAB_SWITCH};

const PAGE_ROWS: usize = 100;
const SCROLLED_PAGES: usize = 10;

pub struct Fixtures {
    pub history: PathBuf,
    pub worktree: PathBuf,
    pub changeset: PathBuf,
    pub tabs: PathBuf,
}

type Action = fn(&Core, &Fixtures) -> Result<(), ApiError>;
type MeasuredAction = fn(&Core, &Fixtures) -> Result<Measured, ApiError>;

/// What a scenario that times itself reports: the figure compared with the scenario's
/// threshold, and everything else it recorded.
pub struct Measured {
    pub elapsed_ms: f64,
    pub details: Vec<Measurement>,
}

enum Run {
    Timed(Action),
    Measured(MeasuredAction),
}

pub struct Scenario {
    name: &'static str,
    run: Run,
    threshold: Option<&'static Threshold>,
    warm_up: bool,
}

impl Scenario {
    pub fn new(name: &'static str, action: Action) -> Self {
        Self {
            name,
            run: Run::Timed(action),
            threshold: None,
            warm_up: false,
        }
    }

    /// A scenario that measures itself, for figures a single wall-clock time cannot capture.
    pub fn measuring(name: &'static str, action: MeasuredAction) -> Self {
        Self {
            name,
            run: Run::Measured(action),
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

/// The `open-folder-*` placeholders exercise the whole pipeline; the other scenarios map to the
/// thresholds.
pub fn scenarios() -> Vec<Scenario> {
    vec![
        Scenario::new("history-first-page", |core, fixtures| {
            core.history_page(&fixtures.history, 0, PAGE_ROWS, &HistoryFilter::default())
                .map(drop)
        })
        .against(&GRAPH),
        Scenario::new("history-scroll-ten-pages", |core, fixtures| {
            for page in 1..=SCROLLED_PAGES {
                core.history_page(
                    &fixtures.history,
                    page * PAGE_ROWS,
                    PAGE_ROWS,
                    &HistoryFilter::default(),
                )?;
            }
            Ok(())
        }),
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
        Scenario::new("first-changeset-file", |core, fixtures| {
            let status = core.worktree_status(&fixtures.changeset)?;
            let first = status
                .unstaged
                .first()
                .ok_or_else(|| ApiError::Unexpected {
                    message: "the changeset fixture has no changes".to_owned(),
                })?;
            core.file_diff(
                &fixtures.changeset,
                &DiffRequest {
                    path: first.path.clone(),
                    original_path: None,
                    list: ChangeList::Unstaged,
                    load_large: false,
                },
            )
            .map(drop)
        })
        .after_warm_up()
        .against(&FIRST_CHANGESET_FILE),
        Scenario::measuring("tabs-at-scale", tabs::tabs_at_scale).against(&TAB_SWITCH),
    ]
}

/// Times every scenario and reports against the thresholds; a missed threshold is reported,
/// never an error.
pub fn run(cache: &FixtureCache, scale: &Scale, scenarios: &[Scenario]) -> io::Result<Report> {
    let fixtures = Fixtures {
        history: cache.history(scale)?,
        worktree: cache.worktree(scale)?,
        changeset: cache.changeset(scale)?,
        tabs: cache.tabs(scale)?,
    };
    let core = Core::new(|_| {});

    let mut results = Vec::new();
    for scenario in scenarios {
        let fail = |error: ApiError| io::Error::other(format!("{}: {error}", scenario.name));
        let (elapsed_ms, measurements) = match scenario.run {
            Run::Timed(action) => {
                if scenario.warm_up {
                    action(&core, &fixtures).map_err(fail)?;
                }
                let started = Instant::now();
                action(&core, &fixtures).map_err(fail)?;
                (started.elapsed().as_secs_f64() * 1000.0, Vec::new())
            }
            Run::Measured(action) => {
                let measured = action(&core, &fixtures).map_err(fail)?;
                (measured.elapsed_ms, measured.details)
            }
        };
        results.push(ScenarioResult {
            scenario: scenario.name.to_owned(),
            elapsed_ms,
            threshold: scenario.threshold.map(|threshold| threshold.id),
            verdict: verdict(elapsed_ms, scenario.threshold),
            measurements,
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
