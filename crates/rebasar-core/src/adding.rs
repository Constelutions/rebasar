//! The three ways to add Repositories without the terminal: clone, init and a one-time scan.

use std::collections::HashSet;
use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::mutation::{Mutation, MutationOutcome};
use crate::sync::authentication_hint;
use crate::{
    folder_name, is_repository_folder, open_worktree, platform, repository_folder, ApiError, Core,
    Tab,
};

/// Deep enough for `~/work/<client>/<project>/<repo>`; beyond it a scan would mostly wander
/// through build output and vendored folders.
const MAX_SCAN_DEPTH: usize = 4;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FoundRepository {
    pub path: String,
    pub name: String,
    /// The Repository is in the registry already, so importing would change nothing.
    pub already_added: bool,
}

impl Core {
    /// Clones `url` into a new folder inside `parent`, named after the Repository, and opens it
    /// as a Tab. Output and progress stream through the mutation events. Returns `None` when
    /// the clone was cancelled, after removing what it had written.
    pub fn clone_repository(
        &self,
        url: &str,
        parent: &Path,
        group_id: Option<&str>,
    ) -> Result<Option<Tab>, ApiError> {
        self.check_group(group_id)?;
        let url = url.trim();
        let name = repository_name_from_url(url).ok_or_else(|| ApiError::InvalidRepositoryUrl {
            url: url.to_owned(),
        })?;
        let parent = existing_folder(parent)?;
        let target = parent.join(name);
        let target_is_new = !target.exists();

        let args: Vec<OsString> = vec![
            "clone".into(),
            "--progress".into(),
            "--".into(),
            url.into(),
            target.clone().into_os_string(),
        ];
        let run = self.mutations.run_creating(
            &parent,
            target.clone(),
            Mutation::new(format!("Clone {url}"), args),
        );

        match run.outcome {
            MutationOutcome::Succeeded => self.open_added(&target, group_id).map(Some),
            MutationOutcome::Cancelled => {
                discard_partial(&target, target_is_new);
                Ok(None)
            }
            MutationOutcome::Failed { .. } => {
                discard_partial(&target, target_is_new);
                Err(ApiError::GitFailed {
                    message: explain_clone_failure(&target, &run.error_output),
                })
            }
        }
    }

    /// Turns `folder` into a Repository and opens it as a Tab. Returns `None` when the
    /// initialization was cancelled while it waited its turn.
    pub fn init_repository(
        &self,
        folder: &Path,
        group_id: Option<&str>,
    ) -> Result<Option<Tab>, ApiError> {
        self.check_group(group_id)?;
        let folder = existing_folder(folder)?;
        if is_repository_folder(&folder) {
            return Err(ApiError::AlreadyARepository {
                path: folder.to_string_lossy().into_owned(),
            });
        }

        let run = self.mutations.run_creating(
            &folder,
            folder.clone(),
            Mutation::new(format!("Initialize {}", folder_name(&folder)), ["init"]),
        );

        match run.outcome {
            MutationOutcome::Succeeded => self.open_added(&folder, group_id).map(Some),
            MutationOutcome::Cancelled => Ok(None),
            MutationOutcome::Failed { .. } => Err(ApiError::GitFailed {
                message: last_message(&run.error_output),
            }),
        }
    }

    /// Looks for Repositories below `parent` once, without remembering the folder: there are no
    /// permanently watched roots. A Repository is not searched for further Repositories.
    pub fn scan_folder(&self, parent: &Path) -> Result<Vec<FoundRepository>, ApiError> {
        let parent = existing_folder(parent)?;
        let known: HashSet<String> = self.registry.read(|data| {
            data.repositories
                .iter()
                .map(|record| record.path.clone())
                .collect()
        });

        let mut folders = Vec::new();
        collect_repositories(&parent, 0, &mut folders);
        folders.sort_by_key(|folder| folder.to_string_lossy().to_lowercase());

        Ok(folders
            .into_iter()
            .map(|folder| {
                let path = folder.to_string_lossy().into_owned();
                FoundRepository {
                    name: folder_name(&folder),
                    already_added: known.contains(&path),
                    path,
                }
            })
            .collect())
    }

    /// Adds the Repositories to the registry, in `group_id` when given, without opening Tabs.
    /// Nothing is added if any of them is not a Repository. Ones that are known already stay
    /// where they are.
    pub fn import_repositories(
        &self,
        paths: &[PathBuf],
        group_id: Option<&str>,
    ) -> Result<(), ApiError> {
        let mut repositories = Vec::new();
        for path in paths {
            let (_, repo) = open_worktree(path)?;
            let folder = repository_folder(&repo)?;
            repositories.push((folder.to_string_lossy().into_owned(), folder_name(&folder)));
        }

        self.registry.update(|data| {
            if let Some(id) = group_id {
                data.group_position(id)?;
            }
            for (path, name) in &repositories {
                data.register_repository(path, name, group_id);
            }
            Ok(())
        })
    }

    fn check_group(&self, group_id: Option<&str>) -> Result<(), ApiError> {
        match group_id {
            Some(id) => self.registry.read(|data| data.group_position(id).map(drop)),
            None => Ok(()),
        }
    }

    fn open_added(&self, folder: &Path, group_id: Option<&str>) -> Result<Tab, ApiError> {
        let tab = self.open_folder(folder)?;
        if group_id.is_some() {
            self.move_repository(Path::new(&tab.worktree_path), group_id)?;
        }
        Ok(tab)
    }
}

fn existing_folder(path: &Path) -> Result<PathBuf, ApiError> {
    if !path.is_dir() {
        return Err(ApiError::FolderNotFound {
            path: path.to_string_lossy().into_owned(),
        });
    }
    platform::canonical(path).map_err(ApiError::unexpected)
}

fn collect_repositories(folder: &Path, depth: usize, found: &mut Vec<PathBuf>) {
    // A `.git` file marks a linked Worktree, which belongs to a Repository found elsewhere.
    if folder.join(".git").is_dir() {
        found.push(folder.to_path_buf());
        return;
    }
    if depth == MAX_SCAN_DEPTH {
        return;
    }
    let Ok(entries) = fs::read_dir(folder) else {
        return;
    };
    for entry in entries.flatten() {
        // `DirEntry::file_type` does not follow symlinks, so a link cannot lead the scan in
        // circles.
        let is_folder = entry.file_type().is_ok_and(|kind| kind.is_dir());
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if is_folder && !name.starts_with('.') && name != "node_modules" {
            collect_repositories(&entry.path(), depth + 1, found);
        }
    }
}

/// What `git clone` would call the folder: the last part of the URL without `.git`.
fn repository_name_from_url(url: &str) -> Option<&str> {
    let trimmed = url.trim_end_matches(['/', '\\']);
    let trimmed = trimmed.strip_suffix(".git").unwrap_or(trimmed);
    let name = trimmed.rsplit(['/', '\\', ':']).next()?;
    (!name.is_empty()).then_some(name)
}

/// Git removes what it wrote when it fails on its own, but not when it is killed.
fn discard_partial(target: &Path, target_is_new: bool) {
    if target_is_new {
        let _ = fs::remove_dir_all(target);
    }
}

fn explain_clone_failure(target: &Path, error_output: &[String]) -> String {
    let output = error_output.join("\n").to_lowercase();
    let mentions = |phrases: &[&str]| phrases.iter().any(|phrase| output.contains(phrase));

    if mentions(&["already exists and is not an empty directory"]) {
        format!(
            "The folder {} already exists and is not empty.",
            target.display()
        )
    } else if mentions(&["could not resolve host", "failed to connect", "timed out"]) {
        "Could not reach the server. Check the URL and your network connection.".to_owned()
    } else if let Some(hint) = authentication_hint(error_output) {
        hint
    } else if mentions(&["not found", "does not exist", "does not appear to be a git repository"])
    {
        "No Repository was found at that URL.".to_owned()
    } else {
        last_message(error_output)
    }
}

fn last_message(error_output: &[String]) -> String {
    error_output
        .iter()
        .rev()
        .map(|line| line.trim())
        .find(|line| !line.is_empty())
        .map(|line| line.strip_prefix("fatal: ").unwrap_or(line).to_owned())
        .unwrap_or_else(|| "git failed without saying why.".to_owned())
}
