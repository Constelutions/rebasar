//! Tags and remotes.

use std::path::Path;

use gix::bstr::ByteSlice;
use gix::refs::Category;
use serde::Serialize;

use crate::mutation::Mutation;
use crate::safety::Loss;
use crate::sync::count_unreached;
use crate::{open_worktree, ApiError, Core, MutationOutcome};

const SHORT_ID_LENGTH: usize = 7;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TagInfo {
    pub name: String,
    /// An annotated tag is an object of its own, with a message and a tagger.
    pub annotated: bool,
    /// The commit the tag points at, even through an annotated tag.
    pub short_id: String,
    pub subject: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteInfo {
    pub name: String,
    pub url: String,
    /// Empty when pushes go to the same address.
    pub push_url: String,
}

impl Core {
    pub fn list_tags(&self, worktree: &Path) -> Result<Vec<TagInfo>, ApiError> {
        let (_, repo) = open_worktree(worktree)?;
        let mut tags = Vec::new();
        for reference in repo
            .references()
            .map_err(ApiError::unexpected)?
            .all()
            .map_err(ApiError::unexpected)?
        {
            let mut reference = reference.map_err(ApiError::unexpected)?;
            let Some((Category::Tag, short_name)) = reference.name().category_and_short_name()
            else {
                continue;
            };
            let name = short_name.to_string();
            let target = reference.target().try_id().map(|id| id.to_owned());
            let annotated = match target {
                Some(id) => repo
                    .find_object(id)
                    .map_err(ApiError::unexpected)?
                    .kind
                    .is_tag(),
                None => false,
            };
            let commit_id = reference.peel_to_id().map_err(ApiError::unexpected)?.detach();
            let subject = repo
                .find_commit(commit_id)
                .ok()
                .and_then(|commit| commit.message().ok().map(|m| m.summary().to_str_lossy().into_owned()))
                .unwrap_or_default();
            tags.push(TagInfo {
                name,
                annotated,
                short_id: commit_id.to_hex_with_len(SHORT_ID_LENGTH).to_string(),
                subject,
            });
        }
        tags.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
        Ok(tags)
    }

    /// A lightweight tag, or an annotated one when `message` is given, at HEAD.
    pub fn create_tag_here(
        &self,
        worktree: &Path,
        name: &str,
        message: Option<&str>,
    ) -> Result<MutationOutcome, ApiError> {
        require_name(name)?;
        let mut args = vec!["tag".to_owned()];
        if let Some(message) = message.map(str::trim).filter(|m| !m.is_empty()) {
            args.extend(["--annotate".to_owned(), "--message".to_owned(), message.to_owned()]);
        }
        args.extend(["--end-of-options".to_owned(), name.to_owned()]);
        self.mutations
            .run(worktree, Mutation::new(format!("Create tag {name}"), args))
    }

    /// Deletes the tag here only. Confirm through `MutationKind::DeleteTag` first.
    pub fn delete_tag(&self, worktree: &Path, name: &str) -> Result<MutationOutcome, ApiError> {
        require_name(name)?;
        self.mutations.run(
            worktree,
            Mutation::new(
                format!("Delete tag {name}"),
                ["tag", "--delete", "--end-of-options", name],
            ),
        )
    }

    pub fn push_tag(
        &self,
        worktree: &Path,
        name: &str,
        remote: &str,
    ) -> Result<MutationOutcome, ApiError> {
        require_name(name)?;
        require_name(remote)?;
        self.mutations.run(
            worktree,
            Mutation::new(
                format!("Push tag {name}"),
                vec!["push".to_owned(), remote.to_owned(), format!("refs/tags/{name}")],
            ),
        )
    }

    /// Removes the tag from the remote; the local tag stays.
    pub fn delete_remote_tag(
        &self,
        worktree: &Path,
        name: &str,
        remote: &str,
    ) -> Result<MutationOutcome, ApiError> {
        require_name(name)?;
        require_name(remote)?;
        self.mutations.run(
            worktree,
            Mutation::new(
                format!("Delete tag {name} on {remote}"),
                vec![
                    "push".to_owned(),
                    remote.to_owned(),
                    "--delete".to_owned(),
                    format!("refs/tags/{name}"),
                ],
            ),
        )
    }

    pub fn list_remotes(&self, worktree: &Path) -> Result<Vec<RemoteInfo>, ApiError> {
        let (_, repo) = open_worktree(worktree)?;
        let mut remotes = Vec::new();
        for name in repo.remote_names() {
            let remote = repo.find_remote(&*name).map_err(ApiError::unexpected)?;
            let url = |direction| {
                remote
                    .url(direction)
                    .map(|url| url.to_bstring().to_string())
                    .unwrap_or_default()
            };
            let fetch = url(gix::remote::Direction::Fetch);
            let push = url(gix::remote::Direction::Push);
            remotes.push(RemoteInfo {
                name: name.to_string(),
                push_url: if push == fetch { String::new() } else { push },
                url: fetch,
            });
        }
        remotes.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(remotes)
    }

    pub fn add_remote(&self, worktree: &Path, name: &str, url: &str) -> Result<MutationOutcome, ApiError> {
        require_name(name)?;
        require_url(url)?;
        self.mutations.run(
            worktree,
            Mutation::new(format!("Add remote {name}"), ["remote", "add", name, url.trim()]),
        )
    }

    pub fn rename_remote(
        &self,
        worktree: &Path,
        name: &str,
        new_name: &str,
    ) -> Result<MutationOutcome, ApiError> {
        require_name(name)?;
        require_name(new_name)?;
        self.mutations.run(
            worktree,
            Mutation::new(
                format!("Rename remote {name} to {new_name}"),
                ["remote", "rename", name, new_name],
            ),
        )
    }

    /// Changes where the remote fetches from, and pushes to unless it has an address of its own.
    pub fn set_remote_url(&self, worktree: &Path, name: &str, url: &str) -> Result<MutationOutcome, ApiError> {
        require_name(name)?;
        require_url(url)?;
        self.mutations.run(
            worktree,
            Mutation::new(
                format!("Change the address of {name}"),
                ["remote", "set-url", name, url.trim()],
            ),
        )
    }

    /// Forgets the remote and its remote-tracking branches; nothing local is lost.
    pub fn remove_remote(&self, worktree: &Path, name: &str) -> Result<MutationOutcome, ApiError> {
        require_name(name)?;
        self.mutations.run(
            worktree,
            Mutation::new(format!("Remove remote {name}"), ["remote", "remove", name]),
        )
    }
}

/// What deleting the tag would lose: commits only it reaches.
pub(crate) fn delete_tag_loss(repo: &gix::Repository, name: &str) -> Result<Loss, ApiError> {
    let full_name = format!("refs/tags/{name}");
    let Some(mut tag) = repo
        .try_find_reference(full_name.as_str())
        .map_err(ApiError::unexpected)?
    else {
        return Ok(Loss::default());
    };
    let tip = tag.peel_to_id().map_err(ApiError::unexpected)?.detach();

    let mut others = Vec::new();
    for reference in repo
        .references()
        .map_err(ApiError::unexpected)?
        .all()
        .map_err(ApiError::unexpected)?
    {
        let mut reference = reference.map_err(ApiError::unexpected)?;
        if reference.name().as_bstr() == full_name.as_bytes() {
            continue;
        }
        let Some((category, _)) = reference.name().category_and_short_name() else {
            continue;
        };
        if matches!(category, Category::LocalBranch | Category::RemoteBranch | Category::Tag) {
            if let Ok(id) = reference.peel_to_id() {
                others.push(id.detach());
            }
        }
    }
    if let Ok(head) = repo.head_id() {
        others.push(head.detach());
    }
    let unique = count_unreached(repo, tip, others)?;
    Ok(Loss {
        commits: unique,
        unpushed_commits: unique,
        ..Loss::default()
    })
}

/// A name starting with a dash could be read by `git` as an option.
fn require_name(name: &str) -> Result<(), ApiError> {
    if name.trim().is_empty() || name.starts_with('-') {
        return Err(ApiError::Unexpected {
            message: format!("{name:?} is not a valid name"),
        });
    }
    Ok(())
}

fn require_url(url: &str) -> Result<(), ApiError> {
    if url.trim().is_empty() || url.trim().starts_with('-') {
        return Err(ApiError::Unexpected {
            message: format!("{url:?} is not a valid address"),
        });
    }
    Ok(())
}
