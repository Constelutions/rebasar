use std::cmp::{Ordering, Reverse};
use std::collections::{BinaryHeap, HashMap};

use gix::ObjectId;

use super::refs::Snapshot;
use super::{Edge, EdgeKind, HistoryPage, HistoryRow, RefLabel};
use crate::ApiError;

/// The graph of one Worktree, laid out row by row for as far as it has been asked for.
#[derive(Default)]
pub(crate) struct Layout {
    fingerprint: Option<u64>,
    labels: HashMap<ObjectId, Vec<RefLabel>>,
    rows: Vec<HistoryRow>,
    walk: Walk,
}

impl Layout {
    /// Starts over from the snapshot's tips unless it is the one this layout was built from.
    pub fn follow(&mut self, snapshot: Snapshot) {
        if self.fingerprint == Some(snapshot.fingerprint) {
            return;
        }
        *self = Self {
            fingerprint: Some(snapshot.fingerprint),
            walk: Walk::default(),
            rows: Vec::new(),
            labels: snapshot.labels,
        };
        self.walk.pending_tips = self.labels.keys().copied().collect();
    }

    pub fn extend_to(&mut self, repo: &gix::Repository, row_count: usize) -> Result<(), ApiError> {
        while self.rows.len() < row_count {
            let Some((id, mut row)) = self.walk.next_row(repo)? else {
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

struct CommitData {
    id: ObjectId,
    parents: Vec<ObjectId>,
    time: i64,
    author_name: String,
    author_email: String,
    subject: String,
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
    seen: HashMap<ObjectId, Seen>,
    lanes: Vec<Option<ObjectId>>,
    next_sequence: u64,
}

impl Walk {
    fn next_row(
        &mut self,
        repo: &gix::Repository,
    ) -> Result<Option<(ObjectId, HistoryRow)>, ApiError> {
        self.load_tips(repo)?;
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
        for parent in &commit.parents {
            if let Some(existing) = self.lane_awaiting(*parent) {
                outgoing.push(existing);
                continue;
            }
            if self.seen.get(parent) == Some(&Seen::Listed) {
                // Its clock was ahead of this commit's, so it was listed before this child was
                // known. The line would have to run upwards; leaving it out is the lesser evil.
                continue;
            }
            if !self.seen.contains_key(parent) {
                if let Some(data) = read_commit(repo, *parent)? {
                    self.push(data);
                } else {
                    continue;
                }
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

    fn load_tips(&mut self, repo: &gix::Repository) -> Result<(), ApiError> {
        for tip in std::mem::take(&mut self.pending_tips) {
            if self.seen.contains_key(&tip) {
                continue;
            }
            if let Some(data) = read_commit(repo, tip)? {
                self.push(data);
            }
        }
        Ok(())
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

/// `None` for an object that is missing or is not a commit, such as a tag on a tree or the
/// parent of a shallow clone's boundary.
fn read_commit(repo: &gix::Repository, id: ObjectId) -> Result<Option<CommitData>, ApiError> {
    let Some(object) = repo.try_find_object(id).map_err(ApiError::unexpected)? else {
        return Ok(None);
    };
    if object.kind != gix::object::Kind::Commit {
        return Ok(None);
    }
    let commit = object.try_to_commit_ref().map_err(ApiError::unexpected)?;
    let author = commit.author().map_err(ApiError::unexpected)?;
    let committer = commit.committer().map_err(ApiError::unexpected)?;
    Ok(Some(CommitData {
        id,
        parents: commit.parents().collect(),
        time: committer.seconds(),
        author_name: author.name.to_string(),
        author_email: author.email.to_string(),
        subject: commit.message().summary().to_string(),
    }))
}
