mod layout;
mod refs;

use std::path::Path;
use std::sync::Arc;

use serde::Serialize;

use crate::{open_worktree, ApiError, Core};

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
    /// Serves rows `offset..offset + limit` of the Worktree's history, newest first. The layout
    /// is computed only as far as the rows asked for, and kept so the next page continues from
    /// there; it is dropped as soon as a ref moves.
    pub fn history_page(
        &self,
        worktree_path: &Path,
        offset: usize,
        limit: usize,
    ) -> Result<HistoryPage, ApiError> {
        let (worktree_path, mut repo) = open_worktree(worktree_path)?;
        repo.object_cache_size_if_unset(OBJECT_CACHE_BYTES);
        let snapshot = refs::Snapshot::read(&repo)?;

        let layout = {
            let mut histories = self.histories.lock().expect("history cache lock");
            Arc::clone(histories.entry(worktree_path).or_default())
        };
        let mut layout = layout.lock().expect("history layout lock");
        layout.follow(snapshot);

        let end = offset.saturating_add(limit);
        layout.extend_to(&repo, end.saturating_add(1))?;
        Ok(layout.page(offset, end))
    }
}
