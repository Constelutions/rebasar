use gix::bstr::ByteSlice;
use gix::revision::walk::Sorting;
use gix::traverse::commit::simple::CommitTimeOrder;
use serde::Serialize;

use crate::ApiError;

/// Keeps the list usable when nothing has ever been pushed from a long history.
const MAX_OUTGOING: usize = 200;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OutgoingCommit {
    pub id: String,
    pub short_id: String,
    pub subject: String,
}

pub(crate) fn read(repo: &gix::Repository) -> Result<Vec<OutgoingCommit>, ApiError> {
    let head = repo.head().map_err(ApiError::unexpected)?;
    let Some(tip) = head.id() else {
        return Ok(Vec::new());
    };

    let hidden = match upstream_tip(repo, &head) {
        Some(upstream) => vec![upstream],
        None => remote_tips(repo)?,
    };

    let walk = repo
        .rev_walk([tip])
        .sorting(Sorting::ByCommitTime(CommitTimeOrder::NewestFirst))
        .with_hidden(hidden)
        .all()
        .map_err(ApiError::unexpected)?;

    let mut commits = Vec::new();
    for info in walk.take(MAX_OUTGOING) {
        let info = info.map_err(ApiError::unexpected)?;
        let commit = info.object().map_err(ApiError::unexpected)?;
        let message = commit.message().map_err(ApiError::unexpected)?;
        commits.push(OutgoingCommit {
            id: info.id.to_string(),
            short_id: info.id.to_hex_with_len(7).to_string(),
            subject: message.summary().to_str_lossy().into_owned(),
        });
    }
    Ok(commits)
}

fn upstream_tip(repo: &gix::Repository, head: &gix::Head<'_>) -> Option<gix::ObjectId> {
    let branch = head.referent_name()?;
    let tracking = repo
        .branch_remote_tracking_ref_name(branch, gix::remote::Direction::Fetch)?
        .ok()?;
    let mut reference = repo.try_find_reference(tracking.as_ref()).ok()??;
    Some(reference.peel_to_id().ok()?.detach())
}

pub(crate) fn remote_tips(repo: &gix::Repository) -> Result<Vec<gix::ObjectId>, ApiError> {
    let references = repo.references().map_err(ApiError::unexpected)?;
    let remote_branches = references
        .prefixed("refs/remotes/")
        .map_err(ApiError::unexpected)?;
    Ok(remote_branches
        .filter_map(Result::ok)
        .filter_map(|mut reference| reference.peel_to_id().ok().map(|id| id.detach()))
        .collect())
}
