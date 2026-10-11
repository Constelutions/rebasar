use std::cmp::{Ordering, Reverse};
use std::collections::{BinaryHeap, HashMap};

use gix::ObjectId;

use super::commit::{read_commit, CommitData};
use super::filter::Filter;
use super::refs::Snapshot;
use super::{Edge, EdgeKind, HistoryPage, HistoryRow, RefLabel};
use crate::ApiError;

/// The graph of one Worktree, laid out row by row for as far as it has been asked for. Only the
/// commits the filter lets through get a row, so the lines connect the nearest ones.
#[derive(Default)]
pub(crate) struct Layout {
    fingerprint: Option<u64>,
    filter: Filter,
    labels: HashMap<ObjectId, Vec<RefLabel>>,
    rows: Vec<HistoryRow>,
    walk: Walk,
}

impl Layout {
    /// Starts over from the filter's tips unless this layout was built from the same refs and
    /// the same filter.
    pub fn follow(&mut self, snapshot: Snapshot, filter: Filter) {
        if self.fingerprint == Some(snapshot.fingerprint) && self.filter == filter {
            return;
        }
        let walk = Walk {
            pending_tips: filter.tips(&snapshot),
            ..Walk::default()
        };
        *self = Self {
            fingerprint: Some(snapshot.fingerprint),
            filter,
            walk,
            rows: Vec::new(),
            labels: snapshot.labels,
        };
    }

    pub fn extend_to(&mut self, repo: &gix::Repository, row_count: usize) -> Result<(), ApiError> {
        while self.rows.len() < row_count {
            let Some((id, mut row)) = self.walk.next_row(repo, &self.filter)? else {
                break;
            };
            if let Some(labels) = self.labels.get(&id) {
                row.refs.clone_from(labels);
            }
            self.rows.push(row);
        }
        Ok(())
    }

    pub fn page(&self, offset: usize, end: usize) -> HistoryPage {
        let start = offset.min(self.rows.len());
        let stop = end.min(self.rows.len());
        HistoryPage {
            offset,
            rows: self.rows[start..stop].to_vec(),
            has_more: self.rows.len() > end,
        }
    }
}

/// A commit waiting in the frontier. Newest first; among commits of the same second, the one
/// found first goes first, so siblings leave before the parent they share.
struct Pending {
    sequence: u64,
    commit: CommitData,
}

impl PartialEq for Pending {
    fn eq(&self, other: &Self) -> bool {
        self.cmp(other) == Ordering::Equal
    }
}

impl Eq for Pending {}

impl PartialOrd for Pending {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for Pending {
    fn cmp(&self, other: &Self) -> Ordering {
        (self.commit.time, Reverse(self.sequence))
            .cmp(&(other.commit.time, Reverse(other.sequence)))
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Seen {
    Waiting,
    Listed,
}

/// Walks the commits newest first, like `git log`, and assigns each one a lane.
///
/// A lane is a column that waits for one particular commit: the next row whose commit is the
/// awaited one sits in that column and either continues the lane with its first parent or
/// hands it on to the other parents. Lanes never move sideways, so a line is the same column
/// at the bottom of one row and at the top of the next.
#[derive(Default)]
struct Walk {
    pending_tips: Vec<ObjectId>,
    frontier: BinaryHeap<Pending>,
    /// The commits the filter lets through that have been found.
    seen: HashMap<ObjectId, Seen>,
    /// For each commit the filter rejects, the nearest accepted ancestors its children link to.
    bridged: HashMap<ObjectId, Vec<ObjectId>>,
    lanes: Vec<Option<ObjectId>>,
    next_sequence: u64,
}

/// One rejected commit whose parents are being looked through.
struct Bridge {
    id: ObjectId,
    parents: Vec<ObjectId>,
    next_parent: usize,
    ancestors: Vec<ObjectId>,
}

enum Entered {
    Resolved(Vec<ObjectId>),
    Rejected(Vec<ObjectId>),
}

impl Walk {
    fn next_row(
        &mut self,
        repo: &gix::Repository,
        filter: &Filter,
    ) -> Result<Option<(ObjectId, HistoryRow)>, ApiError> {
        self.load_tips(repo, filter)?;
        let Some(Pending { commit, .. }) = self.frontier.pop() else {
            return Ok(None);
        };
        self.seen.insert(commit.id, Seen::Listed);

        let mut edges = Vec::new();
        for (lane, awaited) in self.lanes.iter().enumerate() {
            let kind = match awaited {
                Some(id) if *id == commit.id => EdgeKind::Incoming,
                Some(_) => EdgeKind::Through,
                None => continue,
            };
            edges.push(Edge { kind, lane });
        }
        let lanes_above = self.lanes.len();

        let lane = match self.lane_awaiting(commit.id) {
            Some(lane) => lane,
            None => self.free_lane(),
        };
        for converging in self
            .lanes
            .iter_mut()
            .filter(|awaited| **awaited == Some(commit.id))
        {
            *converging = None;
        }

        let mut outgoing = Vec::new();
        for parent in &self.shown_parents(repo, filter, &commit.parents)? {
            if let Some(existing) = self.lane_awaiting(*parent) {
                outgoing.push(existing);
                continue;
            }
            if self.seen.get(parent) == Some(&Seen::Listed) {
                // Its clock was ahead of this commit's, so it was listed before this child was
                // known. The line would have to run upwards; leaving it out is the lesser evil.
                continue;
            }
            let target = if self.lanes[lane].is_none() {
                lane
            } else {
                self.free_lane()
            };
            self.lanes[target] = Some(*parent);
            outgoing.push(target);
        }
        outgoing.sort_unstable();
        outgoing.dedup();
        edges.extend(outgoing.into_iter().map(|lane| Edge {
            kind: EdgeKind::Outgoing,
            lane,
        }));

        while self.lanes.last() == Some(&None) {
            self.lanes.pop();
        }
        let lane_count = lanes_above.max(self.lanes.len()).max(lane + 1);

        let id = commit.id;
        Ok(Some((
            id,
            HistoryRow {
                id: commit.id.to_string(),
                short_id: commit.id.to_hex_with_len(7).to_string(),
                subject: commit.subject,
                author_name: commit.author_name,
                author_email: commit.author_email,
                timestamp: commit.time,
                lane,
                lane_count,
                edges,
                refs: Vec::new(),
            },
        )))
    }

    fn load_tips(&mut self, repo: &gix::Repository, filter: &Filter) -> Result<(), ApiError> {
        for tip in std::mem::take(&mut self.pending_tips) {
            self.nearest_shown(repo, filter, tip)?;
        }
        Ok(())
    }

    /// Where the lines to `parents` end up: each parent the filter lets through, and for each
    /// one it rejects, the nearest ancestors that pass, as if the rejected commits were gone.
    fn shown_parents(
        &mut self,
        repo: &gix::Repository,
        filter: &Filter,
        parents: &[ObjectId],
    ) -> Result<Vec<ObjectId>, ApiError> {
        let mut shown = Vec::new();
        for parent in parents {
            extend_unique(&mut shown, self.nearest_shown(repo, filter, *parent)?);
        }
        Ok(shown)
    }

    /// `id` itself when the filter lets it through, otherwise the nearest ancestors that pass.
    /// Every commit found this way joins the frontier. Rejected commits are looked through with
    /// an explicit stack, as a long run of them would overflow a recursive walk.
    fn nearest_shown(
        &mut self,
        repo: &gix::Repository,
        filter: &Filter,
        id: ObjectId,
    ) -> Result<Vec<ObjectId>, ApiError> {
        let mut open: Vec<Bridge> = Vec::new();
        let mut entering = Some(id);
        let mut resolved: Option<Vec<ObjectId>> = None;
        loop {
            if let Some(id) = entering.take() {
                match self.enter(repo, filter, id)? {
                    Entered::Resolved(found) => resolved = Some(found),
                    Entered::Rejected(parents) => open.push(Bridge {
                        id,
                        parents,
                        next_parent: 0,
                        ancestors: Vec::new(),
                    }),
                }
            }
            if let Some(found) = resolved.take() {
                match open.last_mut() {
                    None => return Ok(found),
                    Some(bridge) => extend_unique(&mut bridge.ancestors, found),
                }
            }
            let bridge = open
                .last_mut()
                .expect("a bridge stays open until it is resolved");
            if let Some(parent) = bridge.parents.get(bridge.next_parent) {
                entering = Some(*parent);
                bridge.next_parent += 1;
            } else {
                let bridge = open.pop().expect("the bridge was just borrowed");
                self.bridged.insert(bridge.id, bridge.ancestors.clone());
                resolved = Some(bridge.ancestors);
            }
        }
    }

    fn enter(
        &mut self,
        repo: &gix::Repository,
        filter: &Filter,
        id: ObjectId,
    ) -> Result<Entered, ApiError> {
        if self.seen.contains_key(&id) {
            return Ok(Entered::Resolved(vec![id]));
        }
        if let Some(ancestors) = self.bridged.get(&id) {
            return Ok(Entered::Resolved(ancestors.clone()));
        }
        match read_commit(repo, id, filter)? {
            None => {
                self.bridged.insert(id, Vec::new());
                Ok(Entered::Resolved(Vec::new()))
            }
            Some((data, true)) => {
                self.push(data);
                Ok(Entered::Resolved(vec![id]))
            }
            Some((data, false)) => Ok(Entered::Rejected(data.parents)),
        }
    }

    fn push(&mut self, commit: CommitData) {
        self.seen.insert(commit.id, Seen::Waiting);
        self.frontier.push(Pending {
            sequence: self.next_sequence,
            commit,
        });
        self.next_sequence += 1;
    }

    fn lane_awaiting(&self, id: ObjectId) -> Option<usize> {
        self.lanes.iter().position(|awaited| *awaited == Some(id))
    }

    fn ensure_lane(&mut self, lane: usize) {
        if self.lanes.len() <= lane {
            self.lanes.resize(lane + 1, None);
        }
    }

    fn free_lane(&mut self) -> usize {
        let lane = self
            .lanes
            .iter()
            .position(Option::is_none)
            .unwrap_or(self.lanes.len());
        self.ensure_lane(lane);
        lane
    }
}

fn extend_unique(into: &mut Vec<ObjectId>, from: Vec<ObjectId>) {
    for id in from {
        if !into.contains(&id) {
            into.push(id);
        }
    }
}
