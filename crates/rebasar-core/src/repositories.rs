use std::path::Path;

use serde::Serialize;

use crate::registry::RepositoryRecord;
use crate::{
    folder_name, is_repository_folder, open_worktree, platform, read_head, repository_folder, ApiError, Core,
    Group, Head,
};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryList {
    /// In the order the user arranged them.
    pub groups: Vec<Group>,
    pub repositories: Vec<RepositoryEntry>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryEntry {
    pub path: String,
    pub name: String,
    /// `None` for a Repository in the default 'Ungrouped' section.
    pub group_id: Option<String>,
    /// Its folder is gone. The Repository stays listed, without Worktrees, until it is located
    /// again or removed.
    pub missing: bool,
    /// The main Worktree first.
    pub worktrees: Vec<WorktreeEntry>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeEntry {
    pub path: String,
    pub main: bool,
    pub head: Head,
}

impl Core {
    /// Lists every known Repository with its Worktrees. Closes the Tabs of Repositories found
    /// missing, so that no Tab outlives its Repository.
    pub fn repositories(&self) -> RepositoryList {
        let (groups, records) = self
            .registry
            .read(|data| (data.groups.clone(), data.repositories.clone()));
        let entries: Vec<RepositoryEntry> = records.iter().map(list).collect();
        for entry in entries.iter().filter(|entry| entry.missing) {
            self.close_tabs_of(&entry.path);
        }
        RepositoryList {
            groups,
            repositories: entries,
        }
    }

    pub fn create_group(&self, name: &str) -> Result<Group, ApiError> {
        let name = valid_group_name(name)?;
        self.registry.update(|data| {
            data.next_group_number += 1;
            let group = Group {
                id: format!("group-{}", data.next_group_number),
                name,
            };
            data.groups.push(group.clone());
            Ok(group)
        })
    }

    pub fn rename_group(&self, id: &str, name: &str) -> Result<(), ApiError> {
        let name = valid_group_name(name)?;
        self.registry.update(|data| {
            let position = data.group_position(id)?;
            data.groups[position].name = name;
            Ok(())
        })
    }

    /// Puts the Group at `index` among the Groups, which is clamped to the last position.
    pub fn move_group(&self, id: &str, index: usize) -> Result<(), ApiError> {
        self.registry.update(|data| {
            let position = data.group_position(id)?;
            let group = data.groups.remove(position);
            data.groups.insert(index.min(data.groups.len()), group);
            Ok(())
        })
    }

    /// A Repository belongs to at most one Group; `None` returns it to 'Ungrouped'.
    pub fn move_repository(&self, path: &Path, group_id: Option<&str>) -> Result<(), ApiError> {
        let path = path.to_string_lossy();
        self.registry.update(|data| {
            let position = data.repository_position(&path)?;
            if let Some(id) = group_id {
                data.group_position(id)?;
            }
            data.repositories[position].group_id = group_id.map(str::to_owned);
            Ok(())
        })
    }

    /// Points a Repository at the folder it moved to, keeping its Group. Its open Tabs close
    /// because their Worktree paths no longer lead anywhere.
    pub fn locate_repository(&self, path: &Path, new_path: &Path) -> Result<(), ApiError> {
        let old = path.to_string_lossy().into_owned();
        let (_, repo) = open_worktree(new_path)?;
        let folder = repository_folder(&repo)?;
        let new = folder.to_string_lossy().into_owned();
        let name = folder_name(&folder);

        self.registry.update(|data| {
            let position = data.repository_position(&old)?;
            if data.repositories.iter().any(|record| record.path == new) && old != new {
                data.repositories.remove(position);
            } else {
                data.repositories[position].path = new;
                data.repositories[position].name = name;
            }
            Ok(())
        })?;
        self.close_tabs_of(&old);
        Ok(())
    }

    /// Forgets the Repository and closes its Tabs. Its folder is left alone.
    pub fn remove_repository(&self, path: &Path) -> Result<(), ApiError> {
        let path = path.to_string_lossy().into_owned();
        self.registry.update(|data| {
            let position = data.repository_position(&path)?;
            data.repositories.remove(position);
            Ok(())
        })?;
        self.close_tabs_of(&path);
        Ok(())
    }
}

fn valid_group_name(name: &str) -> Result<String, ApiError> {
    let name = name.trim();
    if name.is_empty() {
        return Err(ApiError::InvalidGroupName);
    }
    Ok(name.to_owned())
}

fn list(record: &RepositoryRecord) -> RepositoryEntry {
    let missing = !is_repository_folder(Path::new(&record.path));
    RepositoryEntry {
        path: record.path.clone(),
        name: record.name.clone(),
        group_id: record.group_id.clone(),
        missing,
        worktrees: if missing {
            Vec::new()
        } else {
            read_worktrees(Path::new(&record.path)).unwrap_or_default()
        },
    }
}

/// Linked Worktrees whose folder was deleted are left out: they cannot be opened and Git will
/// prune them.
pub(crate) fn read_worktrees(folder: &Path) -> Result<Vec<WorktreeEntry>, ApiError> {
    let (main_path, main) = open_worktree(folder)?;
    let mut worktrees = vec![WorktreeEntry {
        path: main_path.to_string_lossy().into_owned(),
        main: true,
        head: read_head(&main)?,
    }];
    for linked in main.worktrees().map_err(ApiError::unexpected)? {
        if !linked.is_prunable() {
            worktrees.extend(read_linked(linked));
        }
    }
    Ok(worktrees)
}

fn read_linked(linked: gix::worktree::Proxy<'_>) -> Result<WorktreeEntry, ApiError> {
    let path = linked.base().map_err(ApiError::unexpected)?;
    let repo = linked
        .into_repo_with_possibly_inaccessible_worktree()
        .map_err(ApiError::unexpected)?;
    Ok(WorktreeEntry {
        path: platform::canonical(&path)
            .map_err(ApiError::unexpected)?
            .to_string_lossy()
            .into_owned(),
        main: false,
        head: read_head(&repo)?,
    })
}
