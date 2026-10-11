use std::path::Path;

use serde::Serialize;
use serde_json::{Map, Value};

use crate::{is_repository_folder, open_worktree, ApiError, Core, CoreEvent, Tab, WindowBounds};

/// What the user had open when the app last ran.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    /// In the order they were opened, as last seen: nothing has been read from Git yet.
    pub tabs: Vec<Tab>,
    pub active: Option<String>,
    pub view: Option<String>,
}

impl Core {
    /// The Tabs and view to show on launch, without touching any Repository beyond checking that
    /// its folder is still there, so that a launch with many Tabs stays fast. Tabs whose
    /// Repository or Worktree folder is gone are dropped for good.
    pub fn restore_session(&self) -> Session {
        self.registry.remember(|data| {
            data.open_tabs.retain(|open| {
                Path::new(&open.tab.worktree_path).exists()
                    && is_repository_folder(Path::new(&open.repository))
            });
            let active_is_open = data
                .open_tabs
                .iter()
                .any(|open| Some(&open.tab.worktree_path) == data.active_tab.as_ref());
            if !active_is_open {
                data.active_tab = data
                    .open_tabs
                    .last()
                    .map(|open| open.tab.worktree_path.clone());
            }
        });
        self.registry.read(|data| Session {
            tabs: data.open_tabs.iter().map(|open| open.tab.clone()).collect(),
            active: data.active_tab.clone(),
            view: data.layout.view.clone(),
        })
    }

    /// Starts watching a restored Tab as the least recently used one, so that loading Tabs in the
    /// background never takes the place of the one the user is looking at.
    pub fn watch_background_tab(&self, path: &Path) -> Result<(), ApiError> {
        let (worktree_path, repo) = open_worktree(path)?;
        self.with_tabs(|tabs| {
            if tabs.contains(&worktree_path) {
                return Ok(());
            }
            tabs.register_least_recent(worktree_path, &repo)
        })
    }

    pub fn save_view(&self, view: &str) {
        self.registry
            .remember(|data| data.layout.view = Some(view.to_owned()));
    }

    pub fn window_bounds(&self) -> Option<WindowBounds> {
        self.registry.read(|data| data.layout.window)
    }

    /// A maximized window keeps the size it had before, so that un-maximizing after a restart
    /// returns to it. A window with no size, such as a minimized one, is ignored.
    pub fn remember_window(&self, width: u32, height: u32, maximized: bool) {
        self.registry.remember(|data| {
            let (width, height) = match data.layout.window {
                Some(previous) if maximized => (previous.width, previous.height),
                _ => (width, height),
            };
            if width > 0 && height > 0 {
                data.layout.window = Some(WindowBounds {
                    width,
                    height,
                    maximized,
                });
            }
        });
    }

    pub fn saved_settings(&self) -> Map<String, Value> {
        self.registry.read(|data| data.settings.clone())
    }

    pub fn save_settings(&self, settings: Map<String, Value>) -> Result<(), ApiError> {
        self.registry.update(|data| {
            data.settings = settings;
            Ok(())
        })
    }

    pub(crate) fn close_tabs_of(&self, repository: &str) {
        let closed = self.registry.read(|data| data.tabs_of(repository));
        if closed.is_empty() {
            return;
        }
        self.registry.remember(|data| {
            for path in &closed {
                data.forget_tab(path);
            }
        });
        for path in closed {
            self.with_tabs(|tabs| tabs.remove(Path::new(&path)));
            (self.on_event)(CoreEvent::TabClosed {
                worktree_path: path,
            });
        }
    }
}
