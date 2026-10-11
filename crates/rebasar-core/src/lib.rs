use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use serde::Serialize;
use thiserror::Error;

mod history;
pub mod platform;
pub mod query;
mod status;
mod watch;

pub use status::{ChangeKind, FileChange, WorktreeStatus};
use watch::WorktreeWatch;

pub use history::{
    Edge, EdgeKind, HistoryCount, HistoryFilter, HistoryPage, HistoryRow, RefKind, RefLabel,
};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Tab {
    pub repository_name: String,
    pub worktree_path: String,
    pub head: Head,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Head {
    Branch { name: String },
    Detached { commit: String },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum CoreEvent {
    TabOpened { tab: Tab },
    WorktreeChanged { worktree_path: String },
}

#[derive(Debug, Clone, PartialEq, Eq, Error, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ApiError {
    #[error("{path} does not exist")]
    FolderNotFound { path: String },
    #[error("{path} is not a Git repository")]
    NotARepository { path: String },
    #[error("{message}")]
    InvalidQuery {
        message: String,
        start: usize,
        end: usize,
    },
    #[error("{message}")]
    Unexpected { message: String },
}

impl From<query::QueryError> for ApiError {
    fn from(error: query::QueryError) -> Self {
        Self::InvalidQuery {
            message: error.message,
            start: error.start,
            end: error.end,
        }
    }
}

impl ApiError {
    pub fn unexpected(error: impl std::error::Error) -> Self {
        Self::Unexpected {
            message: error.to_string(),
        }
    }
}

pub struct Core {
    on_event: Arc<dyn Fn(CoreEvent) + Send + Sync>,
    watches: Mutex<HashMap<PathBuf, WorktreeWatch>>,
    histories: Mutex<HashMap<PathBuf, Arc<Mutex<history::Layout>>>>,
    totals: Mutex<HashMap<PathBuf, (u64, usize)>>,
}

impl Core {
    pub fn new(on_event: impl Fn(CoreEvent) + Send + Sync + 'static) -> Self {
        Self {
            on_event: Arc::new(on_event),
            watches: Mutex::new(HashMap::new()),
            histories: Mutex::new(HashMap::new()),
            totals: Mutex::new(HashMap::new()),
        }
    }

    /// Emits [`CoreEvent::WorktreeChanged`] after files change under the Worktree, whoever
    /// changed them. Watching an already watched Worktree does nothing.
    pub fn watch_worktree(&self, path: &Path) -> Result<(), ApiError> {
        let (worktree_path, repo) = open_worktree(path)?;
        let mut watches = self.watches.lock().expect("watch registry lock");
        if watches.contains_key(&worktree_path) {
            return Ok(());
        }

        let on_event = Arc::clone(&self.on_event);
        let reported_path = worktree_path.to_string_lossy().into_owned();
        let watch = WorktreeWatch::start(&repo, &worktree_path, move || {
            on_event(CoreEvent::WorktreeChanged {
                worktree_path: reported_path.clone(),
            });
        })?;
        watches.insert(worktree_path, watch);
        Ok(())
    }

    pub fn unwatch_worktree(&self, path: &Path) {
        if let Ok(worktree_path) = platform::canonical(path) {
            self.watches
                .lock()
                .expect("watch registry lock")
                .remove(&worktree_path);
        }
    }

    pub fn worktree_status(&self, path: &Path) -> Result<WorktreeStatus, ApiError> {
        let (_, repo) = open_worktree(path)?;
        status::read(&repo)
    }

    pub fn open_folder(&self, path: &Path) -> Result<Tab, ApiError> {
        let (worktree_path, repo) = open_worktree(path)?;

        let head = match repo.head_name().map_err(ApiError::unexpected)? {
            Some(name) => Head::Branch {
                name: name.shorten().to_string(),
            },
            None => Head::Detached {
                commit: repo
                    .head_id()
                    .map_err(ApiError::unexpected)?
                    .to_hex_with_len(7)
                    .to_string(),
            },
        };
        let common_dir = platform::canonical(repo.common_dir()).map_err(ApiError::unexpected)?;

        let tab = Tab {
            repository_name: common_dir
                .parent()
                .and_then(Path::file_name)
                .map(|name| name.to_string_lossy().into_owned())
                .unwrap_or_default(),
            worktree_path: worktree_path.to_string_lossy().into_owned(),
            head,
        };
        (self.on_event)(CoreEvent::TabOpened { tab: tab.clone() });
        Ok(tab)
    }
}

fn open_worktree(path: &Path) -> Result<(PathBuf, gix::Repository), ApiError> {
    if !path.exists() {
        return Err(ApiError::FolderNotFound {
            path: path.to_string_lossy().into_owned(),
        });
    }
    let worktree_path = platform::canonical(path).map_err(ApiError::unexpected)?;
    // Every Worktree root, main or linked, holds a `.git` entry (a folder or a file). Bare
    // repositories have none and have no Worktree to show as a Tab.
    if !worktree_path.join(".git").exists() {
        return Err(ApiError::NotARepository {
            path: worktree_path.to_string_lossy().into_owned(),
        });
    }
    let repo = gix::open(&worktree_path).map_err(ApiError::unexpected)?;
    Ok((worktree_path, repo))
}
