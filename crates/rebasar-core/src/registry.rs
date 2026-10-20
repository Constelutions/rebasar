use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::{ApiError, Tab};

/// Everything the app remembers between launches, kept as one JSON file so there is no database
/// to migrate, lock or corrupt. Every section defaults to empty, which lets a later version add
/// sections without invalidating a file an older version wrote.
#[derive(Debug, Default, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub(crate) struct RegistryData {
    pub groups: Vec<Group>,
    pub next_group_number: u64,
    pub repositories: Vec<RepositoryRecord>,
    pub open_tabs: Vec<OpenTabRecord>,
    pub active_tab: Option<String>,
    pub layout: Layout,
    pub settings: Map<String, Value>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Group {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RepositoryRecord {
    /// The folder of the main Worktree, which identifies the Repository.
    pub path: String,
    pub name: String,
    pub group_id: Option<String>,
}

/// An open Tab as last seen, so that a restart can show it before any Git work has happened.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OpenTabRecord {
    pub tab: Tab,
    pub repository: String,
}

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub(crate) struct Layout {
    pub view: Option<String>,
    pub window: Option<WindowBounds>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowBounds {
    pub width: u32,
    pub height: u32,
    pub maximized: bool,
}

impl RegistryData {
    /// Returns `false`, changing nothing, when the Repository is already known.
    pub(crate) fn register_repository(
        &mut self,
        path: &str,
        name: &str,
        group_id: Option<&str>,
    ) -> bool {
        if self.repositories.iter().any(|record| record.path == path) {
            return false;
        }
        self.repositories.push(RepositoryRecord {
            path: path.to_owned(),
            name: name.to_owned(),
            group_id: group_id.map(str::to_owned),
        });
        true
    }

    pub(crate) fn remember_tab(&mut self, tab: &Tab, repository: &str) {
        let record = OpenTabRecord {
            tab: tab.clone(),
            repository: repository.to_owned(),
        };
        match self
            .open_tabs
            .iter_mut()
            .find(|open| open.tab.worktree_path == tab.worktree_path)
        {
            Some(open) => *open = record,
            None => self.open_tabs.push(record),
        }
    }

    pub(crate) fn forget_tab(&mut self, worktree_path: &str) {
        self.open_tabs
            .retain(|open| open.tab.worktree_path != worktree_path);
        if self.active_tab.as_deref() == Some(worktree_path) {
            self.active_tab = None;
        }
    }

    pub(crate) fn tabs_of(&self, repository: &str) -> Vec<String> {
        self.open_tabs
            .iter()
            .filter(|open| open.repository == repository)
            .map(|open| open.tab.worktree_path.clone())
            .collect()
    }

    pub(crate) fn group_position(&self, id: &str) -> Result<usize, ApiError> {
        self.groups
            .iter()
            .position(|group| group.id == id)
            .ok_or_else(|| ApiError::GroupNotFound { id: id.to_owned() })
    }

    pub(crate) fn repository_position(&self, path: &str) -> Result<usize, ApiError> {
        self.repositories
            .iter()
            .position(|record| record.path == path)
            .ok_or_else(|| ApiError::RepositoryNotFound {
                path: path.to_owned(),
            })
    }
}

struct Stored {
    data: RegistryData,
    /// What the file holds, so that saving an unchanged registry touches nothing.
    written: String,
}

/// The registry in memory and, when it has a file, on disk. Every update is written before it
/// returns, so a crash loses at most the update in flight.
pub(crate) struct RegistryStore {
    file: Option<PathBuf>,
    stored: Mutex<Stored>,
}

impl RegistryStore {
    pub(crate) fn in_memory() -> Self {
        Self {
            file: None,
            stored: Mutex::new(Stored {
                data: RegistryData::default(),
                written: String::new(),
            }),
        }
    }

    /// Reads the file. One that cannot be understood is set aside as `<file>.invalid` rather than
    /// overwritten, and the registry starts empty.
    pub(crate) fn load(file: PathBuf) -> Self {
        let (data, written) = match fs::read_to_string(&file) {
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                (RegistryData::default(), String::new())
            }
            Ok(contents) => match serde_json::from_str(&contents) {
                Ok(data) => (data, contents),
                Err(_) => {
                    set_aside(&file);
                    (RegistryData::default(), String::new())
                }
            },
            Err(_) => {
                set_aside(&file);
                (RegistryData::default(), String::new())
            }
        };
        Self {
            file: Some(file),
            stored: Mutex::new(Stored { data, written }),
        }
    }

    pub(crate) fn read<T>(&self, read: impl FnOnce(&RegistryData) -> T) -> T {
        read(&self.stored.lock().expect("registry lock").data)
    }

    /// Applies `change` and saves the result. A change that fails is not saved, and one that
    /// fails halfway must leave the data as it found it.
    pub(crate) fn update<T>(
        &self,
        change: impl FnOnce(&mut RegistryData) -> Result<T, ApiError>,
    ) -> Result<T, ApiError> {
        let mut stored = self.stored.lock().expect("registry lock");
        let result = change(&mut stored.data)?;
        self.save(&mut stored)?;
        Ok(result)
    }

    /// For changes that merely remember what the user did: failing to save one must not stop the
    /// user from carrying on, and the next successful save catches up.
    pub(crate) fn remember(&self, change: impl FnOnce(&mut RegistryData)) {
        let _ = self.update(|data| {
            change(data);
            Ok(())
        });
    }

    fn save(&self, stored: &mut Stored) -> Result<(), ApiError> {
        let Some(file) = &self.file else {
            return Ok(());
        };
        let contents = serde_json::to_string_pretty(&stored.data).map_err(ApiError::unexpected)?;
        if contents == stored.written {
            return Ok(());
        }
        write_atomically(file, &contents).map_err(ApiError::unexpected)?;
        stored.written = contents;
        Ok(())
    }
}

/// Writing next to the file and renaming over it means a crash leaves either the old registry or
/// the new one, never half of each.
fn write_atomically(file: &Path, contents: &str) -> io::Result<()> {
    if let Some(folder) = file.parent() {
        fs::create_dir_all(folder)?;
    }
    let mut pending = file.as_os_str().to_owned();
    pending.push(".tmp");
    let pending = PathBuf::from(pending);
    fs::write(&pending, contents)?;
    fs::rename(&pending, file)
}

fn set_aside(file: &Path) {
    let mut aside = file.as_os_str().to_owned();
    aside.push(".invalid");
    let _ = fs::rename(file, PathBuf::from(aside));
}
