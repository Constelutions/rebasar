use std::path::{Component, Path, PathBuf};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::time::{Duration, Instant};

use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};

use crate::{platform, ApiError};

const QUIET_PERIOD: Duration = Duration::from_millis(150);
/// Without a cap, a build writing files continuously would postpone every refresh until it ends.
const MAX_DELAY: Duration = Duration::from_secs(1);

/// Git files whose changes alter what `git status` reports; everything else under the git
/// directory (objects, logs, hooks, locks) is noise.
const RELEVANT_GIT_ENTRIES: [&str; 8] = [
    "index",
    "HEAD",
    "MERGE_HEAD",
    "CHERRY_PICK_HEAD",
    "REVERT_HEAD",
    "rebase-merge",
    "rebase-apply",
    "packed-refs",
];

/// Reports once per burst of changes to a Worktree; dropping it stops the watching.
pub(crate) struct WorktreeWatch {
    _watchers: Vec<RecommendedWatcher>,
}

impl WorktreeWatch {
    pub(crate) fn start(
        repo: &gix::Repository,
        worktree_path: &Path,
        on_changed: impl Fn() + Send + 'static,
    ) -> Result<Self, ApiError> {
        let git_dir = platform::canonical(repo.git_dir()).map_err(ApiError::unexpected)?;
        let common_dir = platform::canonical(repo.common_dir()).map_err(ApiError::unexpected)?;
        let filter = PathFilter {
            worktree: worktree_path.to_owned(),
            git_dir: git_dir.clone(),
            common_dir: common_dir.clone(),
        };

        let (sender, receiver) = mpsc::channel();
        let mut watchers = Vec::new();
        let mut watch = |path: &Path| -> Result<(), ApiError> {
            let sender = sender.clone();
            let mut watcher = notify::recommended_watcher(move |event| {
                let _ = sender.send(event);
            })
            .map_err(ApiError::unexpected)?;
            watcher
                .watch(path, RecursiveMode::Recursive)
                .map_err(ApiError::unexpected)?;
            watchers.push(watcher);
            Ok(())
        };
        watch(worktree_path)?;
        // A linked Worktree keeps its index and HEAD outside its own folder.
        if !git_dir.starts_with(worktree_path) {
            watch(&git_dir)?;
            watch(&common_dir.join("refs"))?;
        }
        drop(sender);

        std::thread::spawn(move || debounce(&receiver, &filter, &on_changed));
        Ok(Self {
            _watchers: watchers,
        })
    }
}

fn debounce(
    receiver: &mpsc::Receiver<notify::Result<Event>>,
    filter: &PathFilter,
    on_changed: &impl Fn(),
) {
    loop {
        loop {
            match receiver.recv() {
                Ok(event) if filter.is_relevant(&event) => break,
                Ok(_) => {}
                Err(_) => return,
            }
        }

        let started = Instant::now();
        let mut deadline = started + QUIET_PERIOD;
        loop {
            match receiver.recv_timeout(deadline.saturating_duration_since(Instant::now())) {
                Ok(event) if filter.is_relevant(&event) => {
                    deadline = (Instant::now() + QUIET_PERIOD).min(started + MAX_DELAY);
                }
                Ok(_) => {}
                Err(RecvTimeoutError::Timeout) => break,
                Err(RecvTimeoutError::Disconnected) => return,
            }
        }
        on_changed();
    }
}

struct PathFilter {
    worktree: PathBuf,
    git_dir: PathBuf,
    common_dir: PathBuf,
}

impl PathFilter {
    fn is_relevant(&self, event: &notify::Result<Event>) -> bool {
        match event {
            Ok(event) => {
                !matches!(event.kind, EventKind::Access(_))
                    && event.paths.iter().any(|path| self.is_relevant_path(path))
            }
            Err(_) => true,
        }
    }

    fn is_relevant_path(&self, path: &Path) -> bool {
        if let Ok(inside_git_dir) = path.strip_prefix(&self.git_dir) {
            return self.is_relevant_git_entry(inside_git_dir);
        }
        if let Ok(inside_common_dir) = path.strip_prefix(&self.common_dir) {
            return starts_with_name(inside_common_dir, "refs");
        }
        match path.strip_prefix(&self.worktree) {
            Ok(inside_worktree) => !starts_with_name(inside_worktree, ".git"),
            Err(_) => false,
        }
    }

    fn is_relevant_git_entry(&self, path: &Path) -> bool {
        starts_with_name(path, "refs")
            || RELEVANT_GIT_ENTRIES
                .iter()
                .any(|name| starts_with_name(path, name))
    }
}

fn starts_with_name(path: &Path, name: &str) -> bool {
    matches!(path.components().next(), Some(Component::Normal(first)) if first == name)
}
