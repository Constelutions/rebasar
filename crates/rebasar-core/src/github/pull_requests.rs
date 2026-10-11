use serde::{Deserialize, Serialize};
use serde_json::json;

use super::graphql;
use super::http::HttpClient;
use super::GitHubRepository;
use crate::ApiError;

const QUERY: &str = "
query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    pullRequests(first: 50, states: OPEN, orderBy: { field: UPDATED_AT, direction: DESC }) {
      nodes {
        number
        title
        url
        isDraft
        headRefName
        baseRefName
        author { login }
        reviewDecision
        commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
      }
    }
  }
}";

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PullRequest {
    pub number: u64,
    pub title: String,
    pub url: String,
    pub author: String,
    pub head_branch: String,
    pub base_branch: String,
    pub is_draft: bool,
    pub checks: CheckState,
    pub review: ReviewState,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum CheckState {
    None,
    Pending,
    Success,
    Failure,
}

/// What GitHub's review decision says; `None` when the branch needs no review or has none yet.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ReviewState {
    None,
    ReviewRequired,
    ChangesRequested,
    Approved,
}

pub fn list(
    http: &dyn HttpClient,
    token: &str,
    repository: &GitHubRepository,
) -> Result<Vec<PullRequest>, ApiError> {
    let answer: Answer = graphql::query(
        http,
        token,
        QUERY,
        json!({ "owner": repository.owner, "name": repository.name }),
    )?;
    let repository = answer
        .repository
        .ok_or_else(|| ApiError::GithubRequestFailed {
            message: format!(
                "GitHub has no repository {}/{} visible to this token",
                repository.owner, repository.name
            ),
        })?;
    Ok(repository
        .pull_requests
        .nodes
        .into_iter()
        .map(Node::into_pull_request)
        .collect())
}

#[derive(Deserialize)]
struct Answer {
    repository: Option<RepositoryNode>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RepositoryNode {
    pull_requests: Connection<Node>,
}

#[derive(Deserialize)]
struct Connection<T> {
    nodes: Vec<T>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Node {
    number: u64,
    title: String,
    url: String,
    is_draft: bool,
    head_ref_name: String,
    base_ref_name: String,
    author: Option<Author>,
    review_decision: Option<String>,
    commits: Connection<CommitNode>,
}

#[derive(Deserialize)]
struct Author {
    login: String,
}

#[derive(Deserialize)]
struct CommitNode {
    commit: Commit,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Commit {
    status_check_rollup: Option<Rollup>,
}

#[derive(Deserialize)]
struct Rollup {
    state: String,
}

impl Node {
    fn into_pull_request(self) -> PullRequest {
        let rollup = self
            .commits
            .nodes
            .into_iter()
            .next()
            .and_then(|node| node.commit.status_check_rollup);
        PullRequest {
            number: self.number,
            title: self.title,
            url: self.url,
            // GitHub reports no author for accounts that were deleted.
            author: self.author.map_or_else(|| "ghost".to_owned(), |a| a.login),
            head_branch: self.head_ref_name,
            base_branch: self.base_ref_name,
            is_draft: self.is_draft,
            checks: check_state(rollup.as_ref().map(|rollup| rollup.state.as_str())),
            review: review_state(self.review_decision.as_deref()),
        }
    }
}

fn check_state(rollup: Option<&str>) -> CheckState {
    match rollup {
        Some("SUCCESS") => CheckState::Success,
        Some("FAILURE" | "ERROR") => CheckState::Failure,
        Some("PENDING" | "EXPECTED") => CheckState::Pending,
        _ => CheckState::None,
    }
}

fn review_state(decision: Option<&str>) -> ReviewState {
    match decision {
        Some("APPROVED") => ReviewState::Approved,
        Some("CHANGES_REQUESTED") => ReviewState::ChangesRequested,
        Some("REVIEW_REQUIRED") => ReviewState::ReviewRequired,
        _ => ReviewState::None,
    }
}
