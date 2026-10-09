use std::path::Path;

use serde::Serialize;
use thiserror::Error;

pub mod platform;

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
#[serde(tag = "type", rename_all = "camelCase")]
pub enum CoreEvent {
    TabOpened { tab: Tab },
}

#[derive(Debug, Clone, PartialEq, Eq, Error, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ApiError {
    #[error("{path} does not exist")]
    FolderNotFound { path: String },
    #[error("{path} is not a Git repository")]
    NotARepository { path: String },
    #[error("{message}")]
    Unexpected { message: String },
}

impl ApiError {
    fn unexpected(error: impl std::error::Error) -> Self {
        Self::Unexpected {
            message: error.to_string(),
        }
    }
}

pub struct Core {
    on_event: Box<dyn Fn(CoreEvent) + Send + Sync>,
}

impl Core {
    pub fn new(on_event: impl Fn(CoreEvent) + Send + Sync + 'static) -> Self {
        Self {
            on_event: Box::new(on_event),
        }
    }

    pub fn open_folder(&self, path: &Path) -> Result<Tab, ApiError> {
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
