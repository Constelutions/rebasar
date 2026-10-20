//! A Repository's linked Worktrees: listing, creating, removing and pruning them.

use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::mutation::Mutation;
use crate::repositories::read_worktrees;
use crate::safety::Loss;
use crate::status::{self, FileChange};
use crate::{
    open_worktree, platform, repository_folder, ApiError, CoreEvent, Head, Core, MutationOutcome,
};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeDetail {
    pub path: String,
    /// The Worktree that holds the Repository itself; it cannot be removed.
    pub main: bool,
    pub head: Head,
    /// It has changes that are not committed, untracked files included.
    pub dirty: bool,
    /// The Worktree the question was asked from.
    pub current: bool,
}

/// What a new Worktree starts from.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum WorktreeStart {
    Branch { name: String },
    /// A commit id or an unambiguous start of one.
    Commit { id: String },
}

impl Core {
    /// The Worktrees of the Repository `worktree` belongs to, the main one first.
    pub fn list_worktree_details(&self, worktree: &Path) -> Result<Vec<WorktreeDetail>, ApiError> {
        let (worktree_path, repo) = open_worktree(worktree)?;
        let folder = repository_folder(&repo)?;
        let current = worktree_path.to_string_lossy().into_owned();

        read_worktrees(&folder)?
            .into_iter()
            .map(|entry| {
                Ok(WorktreeDetail {
                    dirty: !uncommitted_in(Path::new(&entry.path))?.is_empty(),
                    current: entry.path == current,
                    path: entry.path,
                    main: entry.main,
                    head: entry.head,
                })
            })
            .collect()
    }

    /// Adds a Worktree at `path`. Starting from a branch that is not checked out elsewhere
    /// checks that branch out; with `new_branch` a branch of that name is created there, and
    /// starting from a commit without one leaves HEAD detached.
    pub fn create_worktree(
        &self,
        worktree: &Path,
        path: &Path,
        from: &WorktreeStart,
        new_branch: Option<&str>,
    ) -> Result<MutationOutcome, ApiError> {
        let new_branch = new_branch.map(str::trim).filter(|name| !name.is_empty());
        if let Some(name) = new_branch {
            require_name(name)?;
        }
        let start = match from {
            WorktreeStart::Branch { name } => {
                require_name(name)?;
                name.clone()
            }
            WorktreeStart::Commit { id } => {
                let (_, repo) = open_worktree(worktree)?;
                repo.rev_parse_single(id.as_str())
                    .map_err(|_| ApiError::Unexpected {
                        message: format!("{id} is not a commit of this Repository"),
                    })?
                    .to_string()
            }
        };

        let mut args = vec!["worktree".to_owned(), "add".to_owned()];
        match (new_branch, from) {
            (Some(name), _) => args.extend(["-b".to_owned(), name.to_owned()]),
            (None, WorktreeStart::Commit { .. }) => args.push("--detach".to_owned()),
            (None, WorktreeStart::Branch { .. }) => {}
        }
        args.push("--".to_owned());
        args.push(path.to_string_lossy().into_owned());
        args.push(start);
        self.mutations.run(
            worktree,
            Mutation::new(format!("Add worktree {}", path.display()), args),
        )
    }

    /// Removes a linked Worktree and closes its Tab. A Worktree with uncommitted changes needs
    /// `force`, so confirm through `MutationKind::RemoveWorktree` first.
    pub fn remove_worktree(
        &self,
        worktree: &Path,
        target: &Path,
        force: bool,
    ) -> Result<MutationOutcome, ApiError> {
        // Read before the folder is gone: afterwards it can no longer be resolved.
        let canonical = platform::canonical(target).unwrap_or_else(|_| target.to_path_buf());
        let mut args = vec!["worktree".to_owned(), "remove".to_owned()];
        if force {
            args.push("--force".to_owned());
        }
        args.push("--".to_owned());
        args.push(target.to_string_lossy().into_owned());
        let outcome = self.mutations.run(
            worktree,
            Mutation::new(format!("Remove worktree {}", target.display()), args),
        )?;

        if outcome == MutationOutcome::Succeeded {
            self.close_tab(target, &canonical);
        }
        Ok(outcome)
    }

    /// Forgets the administrative files of Worktrees whose folder is gone.
    pub fn prune_worktrees(&self, worktree: &Path) -> Result<MutationOutcome, ApiError> {
        self.mutations.run(
            worktree,
            Mutation::new("Prune worktrees", ["worktree", "prune"]),
        )
    }

    fn close_tab(&self, target: &Path, canonical: &Path) {
        let path = canonical.to_string_lossy().into_owned();
        let target_path = target.to_string_lossy().into_owned();
        for candidate in [path, target_path] {
            let known = self.registry.read(|data| {
                data.open_tabs
                    .iter()
                    .any(|open| open.tab.worktree_path == candidate)
            });
            if known {
                self.registry.remember(|data| data.forget_tab(&candidate));
                self.with_tabs(|tabs| tabs.remove(Path::new(&candidate)));
                (self.on_event)(CoreEvent::TabClosed {
                    worktree_path: candidate,
                });
            }
        }
    }
}

/// What removing the Worktree at `target` would lose: everything not committed in it.
pub(crate) fn remove_loss(target: &str) -> Result<Loss, ApiError> {
    Ok(Loss {
        files: uncommitted_in(Path::new(target))?,
        ..Loss::default()
    })
}

fn uncommitted_in(folder: &Path) -> Result<Vec<FileChange>, ApiError> {
    let (_, repo) = open_worktree(folder)?;
    let status = status::read(&repo)?;
    Ok(status
        .conflicts
        .into_iter()
        .chain(status.staged)
        .chain(status.unstaged)
        .collect())
}

/// A name starting with a dash could be read by `git` as an option.
fn require_name(name: &str) -> Result<(), ApiError> {
    if name.trim().is_empty() || name.starts_with('-') {
        return Err(ApiError::Unexpected {
            message: format!("{name:?} is not a branch name"),
        });
    }
    Ok(())
}
