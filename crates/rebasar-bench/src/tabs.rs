use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use rebasar_core::{ApiError, CacheKind, Core};
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System};

use crate::fixtures::FixtureCache;
use crate::report::Measurement;
use crate::runner::{Fixtures, Measured};

const IDLE_WINDOW: Duration = Duration::from_secs(2);
/// Roughly what a commit graph and a large diff would keep for the active Tab; the point is that
/// it must not pile up as Tabs are switched.
const ACTIVE_TAB_CACHE_BYTES: usize = 8 * 1024 * 1024;
const SWITCH_ROUNDS: usize = 2;
/// Coprime with the usual Tab counts, so consecutive switches land on distant Tabs.
const SWITCH_STRIDE: usize = 7;

/// Every Worktree of the `tabs` fixture open as a Tab with a live status, then switched between.
/// The core is the one measured here, so memory and CPU are the core's share of the app's;
/// the webview is not included.
pub fn tabs_at_scale(_shared: &Core, fixtures: &Fixtures) -> Result<Measured, ApiError> {
    let worktrees = FixtureCache::tab_worktrees(&fixtures.tabs).map_err(ApiError::unexpected)?;
    let events = Arc::new(AtomicUsize::new(0));
    let counter = Arc::clone(&events);
    let core = Core::new(move |_| {
        counter.fetch_add(1, Ordering::Relaxed);
    });
    let mut process = ProcessMeter::new();
    let mut details = Vec::new();
    let mut record = |name: &str, value: f64, unit: &'static str| {
        details.push(Measurement {
            name: name.to_owned(),
            value,
            unit,
        });
    };

    let before = process.sample();
    let opening = Instant::now();
    for worktree in &worktrees {
        core.open_folder(worktree)?;
        core.activate_tab(worktree)?;
        core.worktree_status(worktree)?;
    }
    let opened_in = opening.elapsed();
    let after_open = process.sample();
    record("tabs-open", worktrees.len() as f64, "tabs");
    record("open-all-ms", millis(opened_in), "ms");
    record("memory-before-open-mb", before.memory_mb, "MB");
    record("memory-after-open-mb", after_open.memory_mb, "MB");
    record(
        "cpu-while-opening-ms",
        (after_open.cpu_ms - before.cpu_ms) as f64,
        "ms",
    );

    events.store(0, Ordering::Relaxed);
    std::thread::sleep(IDLE_WINDOW);
    let after_idle = process.sample();
    let idle_cpu_ms = after_idle.cpu_ms - after_open.cpu_ms;
    record(
        "cpu-while-idle-percent",
        idle_cpu_ms as f64 / millis(IDLE_WINDOW) * 100.0,
        "% of one core",
    );
    record(
        "events-while-idle",
        events.load(Ordering::Relaxed) as f64,
        "events",
    );

    let mut switches = Vec::new();
    let mut refreshes = Vec::new();
    for round in 0..worktrees.len() * SWITCH_ROUNDS {
        let worktree = &worktrees[(round * SWITCH_STRIDE + 3) % worktrees.len()];
        let started = Instant::now();
        core.activate_tab(worktree)?;
        switches.push(millis(started.elapsed()));
        core.store_cache(
            worktree,
            CacheKind::Graph,
            vec![1u8; ACTIVE_TAB_CACHE_BYTES],
        );
        let started = Instant::now();
        core.worktree_status(worktree)?;
        refreshes.push(millis(started.elapsed()));
    }
    let after_switching = process.sample();
    record("memory-after-switching-mb", after_switching.memory_mb, "MB");
    record("tab-switch-median-ms", median(&mut switches), "ms");
    let slowest_switch = max(&switches);
    record("tab-switch-max-ms", slowest_switch, "ms");
    record(
        "refresh-after-switch-median-ms",
        median(&mut refreshes),
        "ms",
    );
    record("refresh-after-switch-max-ms", max(&refreshes), "ms");

    Ok(Measured {
        elapsed_ms: slowest_switch,
        details,
    })
}

fn millis(duration: Duration) -> f64 {
    duration.as_secs_f64() * 1000.0
}

fn median(values: &mut [f64]) -> f64 {
    values.sort_by(f64::total_cmp);
    values[values.len() / 2]
}

fn max(values: &[f64]) -> f64 {
    values.iter().copied().fold(0.0, f64::max)
}

struct ProcessSample {
    memory_mb: f64,
    cpu_ms: u64,
}

struct ProcessMeter {
    system: System,
    pid: Pid,
}

impl ProcessMeter {
    fn new() -> Self {
        Self {
            system: System::new(),
            pid: Pid::from_u32(std::process::id()),
        }
    }

    fn sample(&mut self) -> ProcessSample {
        self.system.refresh_processes_specifics(
            ProcessesToUpdate::Some(&[self.pid]),
            true,
            ProcessRefreshKind::nothing().with_memory().with_cpu(),
        );
        let process = self
            .system
            .process(self.pid)
            .expect("the benchmark process is running");
        ProcessSample {
            memory_mb: process.memory() as f64 / (1024.0 * 1024.0),
            cpu_ms: process.accumulated_cpu_time(),
        }
    }
}
