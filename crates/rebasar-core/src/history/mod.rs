mod commit;
mod count;
mod filter;
mod layout;
mod refs;

use std::path::Path;
use std::sync::Arc;

use serde::Serialize;

use crate::{open_worktree, ApiError, Core};

pub(crate) use filter::Filter;
pub use filter::{HistoryCount, HistoryFilter};
pub(crate) use layout::Layout;

const OBJECT_CACHE_BYTES: usize = 64 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryPage {
    pub offset: usize,
    pub rows: Vec<HistoryRow>,
    pub has_more: bool,
}

/// One commit and the lines the graph draws through its row.
///
/// Lines run between the top and the bottom edge of the row, with the commit's dot on the
/// middle of it: `lane` is the dot's column and every [`Edge`] names the column where its line
/// touches the top or the bottom edge.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryRow {
    pub id: String,
    pub short_id: String,
    pub subject: String,
    pub author_name: String,
    pub author_email: String,
    pub timestamp: i64,
    pub lane: usize,
    pub lane_count: usize,
    pub edges: Vec<Edge>,
    pub refs: Vec<RefLabel>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Edge {
    pub kind: EdgeKind,
    pub lane: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum EdgeKind {
    /// A line that crosses the row without touching the commit.
    Through,
    /// A line from the top edge, in `lane`, down to the commit.
    Incoming,
    /// A line from the commit down to the bottom edge, in `lane`.
    Outgoing,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize)]
pub struct RefLabel {
    pub kind: RefKind,
    pub name: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum RefKind {
    Head,
    LocalBranch,
    RemoteBranch,
    Tag,
}

impl Core {
    /// Serves rows `offset..offset + limit` of the Worktree's history, newest first, laid out
    /// from the commits `filter` lets through. The layout is computed only as far as the rows
    /// asked for, and kept so the next page continues from there; it is dropped as soon as a
    /// ref moves or the filter changes.
    pub fn history_page(
        &self,
        worktree_path: &Path,
        offset: usize,
        limit: usize,
        filter: &HistoryFilter,
    ) -> Result<HistoryPage, ApiError> {
        let (worktree_path, mut repo) = open_worktree(worktree_path)?;
        repo.object_cache_size_if_unset(OBJECT_CACHE_BYTES);
        let snapshot = refs::Snapshot::read(&repo)?;
        let filter = Filter::resolve(filter, &repo)?;

        let layout = {
            let mut histories = self.histories.lock().expect("history cache lock");
            Arc::clone(histories.entry(worktree_path).or_default())
        };
        let mut layout = layout.lock().expect("history layout lock");
        layout.follow(snapshot, filter);

        let end = offset.saturating_add(limit);
        layout.extend_to(&repo, end.saturating_add(1))?;
        Ok(layout.page(offset, end))
    }

    /// How many commits `filter` lets through, out of every commit in the Worktree's history.
    /// Walks the whole history, so it is exact but not as quick as a page.
    pub fn history_count(
        &self,
        worktree_path: &Path,
        filter: &HistoryFilter,
    ) -> Result<HistoryCount, ApiError> {
        let (worktree_path, mut repo) = open_worktree(worktree_path)?;
        repo.object_cache_size_if_unset(OBJECT_CACHE_BYTES);
        let snapshot = refs::Snapshot::read(&repo)?;
        let filter = Filter::resolve(filter, &repo)?;

        let total = {
            let mut totals = self.totals.lock().expect("history totals lock");
            match totals.get(&worktree_path) {
                Some((fingerprint, total)) if *fingerprint == snapshot.fingerprint => *total,
                _ => {
                    let every_tip = snapshot.labels.keys().copied().collect();
                    let total = count::count_matching(&repo, &Filter::default(), every_tip)?;
                    totals.insert(worktree_path, (snapshot.fingerprint, total));
                    total
                }
            }
        };
        let matching = if filter.shows_everything() {
            total
        } else {
            count::count_matching(&repo, &filter, filter.tips(&snapshot))?
        };
        Ok(HistoryCount { matching, total })
    }
}
