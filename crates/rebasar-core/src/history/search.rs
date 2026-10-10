use std::collections::HashSet;
use std::path::Path;

use gix::hash::Prefix;
use gix::ObjectId;
use serde::Serialize;

use super::commit::{read_commit, CommitData};
use super::filter::Filter;
use super::refs::Snapshot;
use super::{HistoryFilter, Layout, RefKind, RefLabel};
use crate::query::{Query, Term};
use crate::{open_worktree, ApiError, Core};

/// A commit the command palette offers to jump to.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitHit {
    pub id: String,
    pub short_id: String,
    pub subject: String,
    pub author_name: String,
    pub timestamp: i64,
}

impl From<CommitData> for CommitHit {
    fn from(commit: CommitData) -> Self {
        Self {
            id: commit.id.to_string(),
            short_id: commit.id.to_hex_with_len(7).to_string(),
            subject: commit.subject,
            author_name: commit.author_name,
            timestamp: commit.time,
        }
    }
}

const MIN_HASH_DIGITS: usize = 4;

impl Core {
    /// The commits of every branch and tag that match `query`, the newest `limit` of them. The
    /// query is the History filter's: `author:`, `path:`, `branch:`, `since:`, `until:` and text
    /// that must appear in the message. A query that is one hexadecimal word also finds the
    /// commits whose hash starts with it, ahead of the others. Does not disturb the graph the
    /// History view has laid out.
    pub fn find_commits(
        &self,
        worktree_path: &Path,
        query: &str,
        limit: usize,
    ) -> Result<Vec<CommitHit>, ApiError> {
        let (_, mut repo) = open_worktree(worktree_path)?;
        repo.object_cache_size_if_unset(super::OBJECT_CACHE_BYTES);
        let snapshot = Snapshot::read(&repo)?;
        let filter = Filter::resolve(
            &HistoryFilter {
                query: query.to_owned(),
                ..HistoryFilter::default()
            },
            &repo,
        )?;

        let mut hits: Vec<CommitHit> = Vec::new();
        if let Some(digits) = hash_digits(&Query::parse(query)?) {
            hits.extend(
                commits_with_prefix(&repo, digits)?
                    .into_iter()
                    .map(CommitHit::from),
            );
        }

        let mut layout = Layout::default();
        layout.follow(snapshot, filter);
        layout.extend_to(&repo, limit)?;
        let by_message = layout.page(0, limit).rows.into_iter().map(|row| CommitHit {
            id: row.id,
            short_id: row.short_id,
            subject: row.subject,
            author_name: row.author_name,
            timestamp: row.timestamp,
        });
        for hit in by_message {
            if !hits.iter().any(|known| known.id == hit.id) {
                hits.push(hit);
            }
        }
        hits.truncate(limit);
        Ok(hits)
    }

    /// The local and remote branches of the Repository, sorted by name.
    pub fn list_branches(&self, worktree_path: &Path) -> Result<Vec<RefLabel>, ApiError> {
        let (_, repo) = open_worktree(worktree_path)?;
        let snapshot = Snapshot::read(&repo)?;
        let mut branches: Vec<RefLabel> = snapshot
            .labels
            .into_values()
            .flatten()
            .filter(|label| matches!(label.kind, RefKind::LocalBranch | RefKind::RemoteBranch))
            .collect();
        branches.sort_by(|a, b| (a.kind, &a.name).cmp(&(b.kind, &b.name)));
        branches.dedup();
        Ok(branches)
    }
}

fn hash_digits(query: &Query) -> Option<&str> {
    match query.terms.as_slice() {
        [Term::Text(text)]
            if (MIN_HASH_DIGITS..=40).contains(&text.len())
                && text.bytes().all(|byte| byte.is_ascii_hexdigit()) =>
        {
            Some(text)
        }
        _ => None,
    }
}

fn commits_with_prefix(repo: &gix::Repository, digits: &str) -> Result<Vec<CommitData>, ApiError> {
    let prefix = Prefix::from_hex(&digits.to_ascii_lowercase()).map_err(ApiError::unexpected)?;
    let mut candidates: HashSet<ObjectId> = HashSet::new();
    repo.objects
        .lookup_prefix(prefix, Some(&mut candidates))
        .map_err(ApiError::unexpected)?;

    let mut commits = Vec::new();
    for id in candidates {
        if let Some((commit, _)) = read_commit(repo, id, &Filter::default())? {
            commits.push(commit);
        }
    }
    commits.sort_by(|a, b| b.time.cmp(&a.time).then(a.id.cmp(&b.id)));
    Ok(commits)
}
