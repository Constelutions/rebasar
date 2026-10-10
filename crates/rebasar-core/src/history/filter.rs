use gix::bstr::{BStr, ByteSlice};
use gix::ObjectId;
use serde::{Deserialize, Serialize};

use super::refs::Snapshot;
use super::RefKind;
use crate::query::{Query, Term};
use crate::ApiError;

/// What the History filter bar asks for: a typed query plus the quick chips.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryFilter {
    pub query: String,
    /// Off narrows History to the commits reachable from HEAD.
    pub all_branches: bool,
    /// Only commits authored by the identity in the Repository's Git configuration.
    pub mine: bool,
    pub merges: bool,
}

impl Default for HistoryFilter {
    fn default() -> Self {
        Self {
            query: String::new(),
            all_branches: true,
            mine: false,
            merges: false,
        }
    }
}

/// `matching` commits out of the `total` in the whole History, branches and tags included.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryCount {
    pub matching: usize,
    pub total: usize,
}

/// A [`HistoryFilter`] with its query parsed and the identity looked up, ready to test commits.
/// Comparing two of them tells whether a laid-out History is still the one being asked for.
///
/// Every term must hold. The exception is `branch:`, which does not test a commit but picks
/// which branches the History starts from, so several `branch:` terms show all of them. A
/// `branch:` term wins over the All branches chip.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub(crate) struct Filter {
    texts: Vec<String>,
    authors: Vec<String>,
    paths: Vec<String>,
    branches: Vec<String>,
    since: Option<i64>,
    until: Option<i64>,
    all_branches: bool,
    mine: Option<String>,
    merges: bool,
}

pub(super) struct Candidate<'a> {
    pub parents: &'a [ObjectId],
    pub tree: ObjectId,
    pub time: i64,
    pub author_name: &'a str,
    pub author_email: &'a str,
    pub message: &'a BStr,
}

impl Filter {
    pub fn resolve(filter: &HistoryFilter, repo: &gix::Repository) -> Result<Self, ApiError> {
        let mut resolved = Self {
            all_branches: filter.all_branches,
            merges: filter.merges,
            ..Self::default()
        };
        for term in Query::parse(&filter.query)?.terms {
            match term {
                Term::Text(text) => resolved.texts.push(text.to_lowercase()),
                Term::Author(author) => resolved.authors.push(author.to_lowercase()),
                Term::Path(path) => resolved.paths.push(path),
                Term::Branch(branch) => resolved.branches.push(branch.to_lowercase()),
                Term::Since(date) => {
                    let start = date.start_of_day();
                    resolved.since =
                        Some(resolved.since.map_or(start, |current| current.max(start)));
                }
                Term::Until(date) => {
                    let end = date.end_of_day();
                    resolved.until = Some(resolved.until.map_or(end, |current| current.min(end)));
                }
            }
        }
        if filter.mine {
            resolved.mine = Some(configured_email(repo)?);
        }
        Ok(resolved)
    }

    /// Whether every commit of the History is shown, so the count of matches is the total.
    pub fn shows_everything(&self) -> bool {
        self.all_branches
            && self.branches.is_empty()
            && self.texts.is_empty()
            && self.authors.is_empty()
            && self.paths.is_empty()
            && self.since.is_none()
            && self.until.is_none()
            && self.mine.is_none()
            && !self.merges
    }

    /// The commits the History starts from.
    pub fn tips(&self, snapshot: &Snapshot) -> Vec<ObjectId> {
        snapshot
            .labels
            .iter()
            .filter(|(_, labels)| {
                labels.iter().any(|label| {
                    if !self.branches.is_empty() {
                        matches!(label.kind, RefKind::LocalBranch | RefKind::RemoteBranch)
                            && self
                                .branches
                                .iter()
                                .any(|branch| label.name.to_lowercase().contains(branch))
                    } else {
                        self.all_branches || label.kind == RefKind::Head
                    }
                })
            })
            .map(|(id, _)| *id)
            .collect()
    }

    pub(super) fn accepts(
        &self,
        repo: &gix::Repository,
        commit: &Candidate<'_>,
    ) -> Result<bool, ApiError> {
        if self.merges && commit.parents.len() < 2 {
            return Ok(false);
        }
        if self.since.is_some_and(|since| commit.time < since)
            || self.until.is_some_and(|until| commit.time >= until)
        {
            return Ok(false);
        }
        if let Some(mine) = &self.mine {
            if !commit.author_email.eq_ignore_ascii_case(mine) {
                return Ok(false);
            }
        }
        if !self.authors.is_empty() {
            let author = format!("{} <{}>", commit.author_name, commit.author_email).to_lowercase();
            if !self.authors.iter().all(|wanted| author.contains(wanted)) {
                return Ok(false);
            }
        }
        if !self.texts.is_empty() {
            let message = commit.message.to_str_lossy().to_lowercase();
            if !self.texts.iter().all(|wanted| message.contains(wanted)) {
                return Ok(false);
            }
        }
        for path in &self.paths {
            if !changes_path(repo, commit, path)? {
                return Ok(false);
            }
        }
        Ok(true)
    }
}

fn configured_email(repo: &gix::Repository) -> Result<String, ApiError> {
    let email = repo.config_snapshot().string("user.email");
    match email {
        Some(email) if !email.trim().is_empty() => Ok(email.to_string()),
        _ => Err(ApiError::Unexpected {
            message: "Mine needs your email: set user.email in the Git configuration".to_owned(),
        }),
    }
}

/// Like `git log -- <path>`: a commit changed the path when it differs from every parent there,
/// so a merge that only brings in a branch's change is not counted as a change of its own.
fn changes_path(
    repo: &gix::Repository,
    commit: &Candidate<'_>,
    path: &str,
) -> Result<bool, ApiError> {
    let here = entry_at(repo, commit.tree, path)?;
    let mut compared = false;
    for parent in commit.parents {
        let Some(tree) = tree_of(repo, *parent)? else {
            continue;
        };
        compared = true;
        if entry_at(repo, tree, path)? == here {
            return Ok(false);
        }
    }
    Ok(compared || here.is_some())
}

fn tree_of(repo: &gix::Repository, commit: ObjectId) -> Result<Option<ObjectId>, ApiError> {
    let Some(object) = repo.try_find_object(commit).map_err(ApiError::unexpected)? else {
        return Ok(None);
    };
    if object.kind != gix::object::Kind::Commit {
        return Ok(None);
    }
    let commit = object.try_to_commit_ref().map_err(ApiError::unexpected)?;
    Ok(Some(commit.tree()))
}

fn entry_at(
    repo: &gix::Repository,
    tree: ObjectId,
    path: &str,
) -> Result<Option<ObjectId>, ApiError> {
    let tree = repo.find_tree(tree).map_err(ApiError::unexpected)?;
    let entry = tree
        .lookup_entry_by_path(path)
        .map_err(ApiError::unexpected)?;
    Ok(entry.map(|entry| entry.object_id()))
}
