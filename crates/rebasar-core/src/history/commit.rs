use gix::ObjectId;

use super::filter::{Candidate, Filter};
use crate::ApiError;

pub(super) struct CommitData {
    pub id: ObjectId,
    pub parents: Vec<ObjectId>,
    pub time: i64,
    pub author_name: String,
    pub author_email: String,
    pub subject: String,
}

/// The commit and whether `filter` lets it through. `None` for an object that is missing or is
/// not a commit, such as a tag on a tree or the parent of a shallow clone's boundary.
pub(super) fn read_commit(
    repo: &gix::Repository,
    id: ObjectId,
    filter: &Filter,
) -> Result<Option<(CommitData, bool)>, ApiError> {
    let Some(object) = repo.try_find_object(id).map_err(ApiError::unexpected)? else {
        return Ok(None);
    };
    if object.kind != gix::object::Kind::Commit {
        return Ok(None);
    }
    let commit = object.try_to_commit_ref().map_err(ApiError::unexpected)?;
    let author = commit.author().map_err(ApiError::unexpected)?;
    let committer = commit.committer().map_err(ApiError::unexpected)?;
    let data = CommitData {
        id,
        parents: commit.parents().collect(),
        time: committer.seconds(),
        author_name: author.name.to_string(),
        author_email: author.email.to_string(),
        subject: commit.message().summary().to_string(),
    };
    let accepted = filter.accepts(
        repo,
        &Candidate {
            parents: &data.parents,
            tree: commit.tree(),
            time: data.time,
            author_name: &data.author_name,
            author_email: &data.author_email,
            message: commit.message,
        },
    )?;
    Ok(Some((data, accepted)))
}
