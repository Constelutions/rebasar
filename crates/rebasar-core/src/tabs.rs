use std::any::Any;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use crate::poll::Poller;
use crate::watch::{WatchError, WorktreeWatch};
use crate::{ApiError, CoreEvent, CoreSettings};

/// The expensive, rebuildable data a Tab keeps for the view the user is looking at. Status is not
/// listed because every Tab keeps it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum CacheKind {
    Graph,
    Diff,
}

type Cached = Arc<dyn Any + Send + Sync>;

enum Mode {
    Watched { _watch: WorktreeWatch },
    Polled { _poller: Poller },
}

struct Entry {
    path: PathBuf,
    active: Arc<AtomicBool>,
    mode: Mode,
    caches: HashMap<CacheKind, Cached>,
}

/// Every open Worktree, least recently used first. Recency decides which Tabs keep their caches
/// and which get a file watcher, so both degrade from the Tabs the user has not touched in the
/// longest.
pub(crate) struct Registry {
    entries: Vec<Entry>,
    settings: CoreSettings,
    /// Starts at the configured limit and shrinks when the operating system refuses a watch.
    watch_limit: usize,
    announced_polling: Vec<String>,
    on_event: Arc<dyn Fn(CoreEvent) + Send + Sync>,
}

impl Registry {
    pub(crate) fn new(
        settings: CoreSettings,
        on_event: Arc<dyn Fn(CoreEvent) + Send + Sync>,
    ) -> Self {
        Self {
            watch_limit: settings.watch_limit.max(1),
            entries: Vec::new(),
            settings,
            announced_polling: Vec::new(),
            on_event,
        }
    }

    pub(crate) fn contains(&self, path: &Path) -> bool {
        self.position(path).is_some()
    }

    /// Opens the Worktree as the most recently used Tab.
    pub(crate) fn register(
        &mut self,
        path: PathBuf,
        repo: &gix::Repository,
    ) -> Result<(), ApiError> {
        let active = Arc::new(AtomicBool::new(false));
        let mode = match self.start_watch(&path, repo, &active) {
            Ok(watch) => Mode::Watched { _watch: watch },
            Err(WatchError::Failed(error)) => return Err(error),
            Err(WatchError::LimitReached) => {
                self.lower_watch_limit();
                Mode::Polled {
                    _poller: self.start_poll(&path, &active),
                }
            }
        };
        self.entries.push(Entry {
            path,
            active,
            mode,
            caches: HashMap::new(),
        });
        self.after_use_changed();
        Ok(())
    }

    pub(crate) fn touch(&mut self, path: &Path) {
        let Some(index) = self.position(path) else {
            return;
        };
        let entry = self.entries.remove(index);
        self.entries.push(entry);
        self.after_use_changed();
    }

    pub(crate) fn remove(&mut self, path: &Path) {
        if let Some(index) = self.position(path) {
            self.entries.remove(index);
            self.after_use_changed();
        }
    }

    pub(crate) fn store_cache(&mut self, path: &Path, kind: CacheKind, value: Cached) -> bool {
        let Some(index) = self.position(path) else {
            return false;
        };
        if self.rank(index) >= self.settings.cached_tabs {
            return false;
        }
        self.entries[index].caches.insert(kind, value);
        true
    }

    pub(crate) fn cache(&self, path: &Path, kind: CacheKind) -> Option<Cached> {
        let index = self.position(path)?;
        self.entries[index].caches.get(&kind).cloned()
    }

    /// The change in which Tabs are polled since the last time this was asked, if there is one.
    pub(crate) fn take_polling_change(&mut self) -> Option<CoreEvent> {
        let polling: Vec<String> = self
            .entries
            .iter()
            .rev()
            .filter(|entry| matches!(entry.mode, Mode::Polled { .. }))
            .map(|entry| entry.path.to_string_lossy().into_owned())
            .collect();
        if polling == self.announced_polling {
            return None;
        }
        self.announced_polling.clone_from(&polling);
        Some(CoreEvent::PollingTabsChanged {
            worktree_paths: polling,
        })
    }

    fn position(&self, path: &Path) -> Option<usize> {
        self.entries.iter().position(|entry| entry.path == path)
    }

    /// 0 for the most recently used Tab.
    fn rank(&self, index: usize) -> usize {
        self.entries.len() - 1 - index
    }

    fn after_use_changed(&mut self) {
        let newest = self.entries.len().saturating_sub(1);
        for (index, entry) in self.entries.iter_mut().enumerate() {
            entry.active.store(index == newest, Ordering::Relaxed);
        }
        let kept = self.settings.cached_tabs;
        let evict_below = self.entries.len().saturating_sub(kept);
        for entry in &mut self.entries[..evict_below] {
            entry.caches.clear();
        }
        self.rebalance();
    }

    /// Gives a file watcher to the most recently used Tabs, up to the limit, and polls the rest.
    fn rebalance(&mut self) {
        loop {
            self.demote_beyond_limit();
            if !self.promote_within_limit() {
                return;
            }
        }
    }

    fn demote_beyond_limit(&mut self) {
        let beyond_limit = self.entries.len().saturating_sub(self.watch_limit);
        for index in 0..beyond_limit {
            if matches!(self.entries[index].mode, Mode::Watched { .. }) {
                let active = Arc::clone(&self.entries[index].active);
                let poller = self.start_poll(&self.entries[index].path, &active);
                self.entries[index].mode = Mode::Polled { _poller: poller };
            }
        }
    }

    /// Returns whether the operating system's limit forced the watch limit down, which means
    /// the demotions have to be done again.
    fn promote_within_limit(&mut self) -> bool {
        let first_within_limit = self.entries.len().saturating_sub(self.watch_limit);
        for index in (first_within_limit..self.entries.len()).rev() {
            if matches!(self.entries[index].mode, Mode::Watched { .. }) {
                continue;
            }
            let path = self.entries[index].path.clone();
            let active = Arc::clone(&self.entries[index].active);
            let Ok((_, repo)) = crate::open_worktree(&path) else {
                continue;
            };
            match self.start_watch(&path, &repo, &active) {
                Ok(watch) => self.entries[index].mode = Mode::Watched { _watch: watch },
                Err(WatchError::LimitReached) => {
                    self.lower_watch_limit();
                    return true;
                }
                Err(WatchError::Failed(_)) => {}
            }
        }
        false
    }

    fn lower_watch_limit(&mut self) {
        let watched = self
            .entries
            .iter()
            .filter(|entry| matches!(entry.mode, Mode::Watched { .. }))
            .count();
        self.watch_limit = watched.max(1).min(self.watch_limit);
    }

    fn start_watch(
        &self,
        path: &Path,
        repo: &gix::Repository,
        active: &Arc<AtomicBool>,
    ) -> Result<WorktreeWatch, WatchError> {
        let on_event = Arc::clone(&self.on_event);
        let reported = path.to_string_lossy().into_owned();
        WorktreeWatch::start(
            repo,
            path,
            Arc::clone(active),
            self.settings.background_quiet,
            move || {
                on_event(CoreEvent::WorktreeChanged {
                    worktree_path: reported.clone(),
                })
            },
        )
    }

    fn start_poll(&self, path: &Path, active: &Arc<AtomicBool>) -> Poller {
        let on_event = Arc::clone(&self.on_event);
        let reported = path.to_string_lossy().into_owned();
        Poller::start(
            path.to_owned(),
            self.settings.poll_interval,
            Arc::clone(active),
            move || {
                on_event(CoreEvent::WorktreeChanged {
                    worktree_path: reported.clone(),
                })
            },
        )
    }
}
