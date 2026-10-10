use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::Arc;
use std::time::Duration;

use crate::{open_worktree, read_tab, status, Tab, WorktreeStatus};

/// Background Tabs are polled this many times less often than the active one.
const BACKGROUND_SLOWDOWN: u32 = 4;

type Fingerprint = Option<(Tab, WorktreeStatus)>;

/// Stands in for a file watcher on a Worktree the operating system can no longer watch; it
/// reports a change when the Tab's branch or status differs from the previous poll. Dropping it
/// stops the polling.
pub(crate) struct Poller {
    _stop: mpsc::Sender<()>,
}

impl Poller {
    pub(crate) fn start(
        worktree_path: PathBuf,
        interval: Duration,
        active: Arc<AtomicBool>,
        on_changed: impl Fn() + Send + 'static,
    ) -> Self {
        let (stop, stopped) = mpsc::channel::<()>();
        std::thread::spawn(move || {
            let mut previous = fingerprint(&worktree_path);
            loop {
                let wait = match active.load(Ordering::Relaxed) {
                    true => interval,
                    false => interval * BACKGROUND_SLOWDOWN,
                };
                match stopped.recv_timeout(wait) {
                    Err(RecvTimeoutError::Timeout) => {}
                    _ => return,
                }
                let current = fingerprint(&worktree_path);
                if current.is_some() && current != previous {
                    on_changed();
                }
                previous = current;
            }
        });
        Self { _stop: stop }
    }
}

fn fingerprint(worktree_path: &std::path::Path) -> Fingerprint {
    let (path, repo) = open_worktree(worktree_path).ok()?;
    Some((read_tab(&repo, &path).ok()?, status::read(&repo).ok()?))
}
