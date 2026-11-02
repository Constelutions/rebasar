//! Creating, updating and publishing pull requests through GitHub's GraphQL API.

use serde::{Deserialize, Serialize};
use serde_json::json;

use super::graphql;
use super::http::HttpClient;
use super::{not_visible, GitHubRepository};
use crate::ApiError;

const FIND: &str = "
query($owner: String!, $name: String!, $head: String!) {
  repository(owner: $owner, name: $name) {
    pullRequests(first: 1, states: OPEN, headRefName: $head) {
      nodes { number title body url isDraft }
    }
  }
}";

const REPOSITORY: &str = "
query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    id
    defaultBranchRef { name }
  }
}";

const CREATE: &str = "
mutation($input: CreatePullRequestInput!) {
  createPullRequest(input: $input) {
    pullRequest { number title body url isDraft }
  }
}";

const NODE_ID: &str = "
query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) { id }
  }
}";

const UPDATE: &str = "
mutation($input: UpdatePullRequestInput!) {
  updatePullRequest(input: $input) {
    pullRequest { number title body url isDraft }
  }
}";

const READY: &str = "
mutation($input: MarkPullRequestReadyForReviewInput!) {
  markPullRequestReadyForReview(input: $input) {
    pullRequest { number title body url isDraft }
  }
}";

/// A pull request with the text a user can edit.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestDetails {
    pub number: u64,
    pub title: String,
    pub body: String,
    pub url: String,
    pub is_draft: bool,
}

#[derive(Deserialize)]
struct FoundAnswer {
    repository: Option<FoundRepository>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FoundRepository {
    pull_requests: Nodes,
}

#[derive(Deserialize)]
struct Nodes {
    nodes: Vec<PullRequestDetails>,
}

pub fn find_for_branch(
    http: &dyn HttpClient,
    token: &str,
    repository: &GitHubRepository,
    branch: &str,
) -> Result<Option<PullRequestDetails>, ApiError> {
    let answer: FoundAnswer = graphql::query(
        http,
        token,
        FIND,
        json!({ "owner": repository.owner, "name": repository.name, "head": branch }),
    )?;
    Ok(answer
        .repository
        .and_then(|repository| repository.pull_requests.nodes.into_iter().next()))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RepositoryAnswer {
    repository: Option<RepositoryInfo>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RepositoryInfo {
    id: String,
    default_branch_ref: Option<BranchRef>,
}

#[derive(Deserialize)]
struct BranchRef {
    name: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateAnswer {
    create_pull_request: Payload,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateAnswer {
    update_pull_request: Payload,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReadyAnswer {
    mark_pull_request_ready_for_review: Payload,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Payload {
    pull_request: PullRequestDetails,
}

pub fn create(
    http: &dyn HttpClient,
    token: &str,
    repository: &GitHubRepository,
    head: &str,
    title: &str,
    body: &str,
    draft: bool,
) -> Result<PullRequestDetails, ApiError> {
    let info: RepositoryAnswer = graphql::query(
        http,
        token,
        REPOSITORY,
        json!({ "owner": repository.owner, "name": repository.name }),
    )?;
    let info = info
        .repository
        .ok_or_else(|| not_visible(repository))?;
    let base = info
        .default_branch_ref
        .map(|branch| branch.name)
        .ok_or_else(|| ApiError::GithubRequestFailed {
            message: "the repository has no default branch to open the pull request against"
                .to_owned(),
        })?;

    let answer: CreateAnswer = graphql::query(
        http,
        token,
        CREATE,
        json!({ "input": {
            "repositoryId": info.id,
            "baseRefName": base,
            "headRefName": head,
            "title": title,
            "body": body,
            "draft": draft,
        }}),
    )?;
    Ok(answer.create_pull_request.pull_request)
}

pub fn update(
    http: &dyn HttpClient,
    token: &str,
    repository: &GitHubRepository,
    number: u64,
    title: &str,
    body: &str,
) -> Result<PullRequestDetails, ApiError> {
    let id = node_id(http, token, repository, number)?;
    let answer: UpdateAnswer = graphql::query(
        http,
        token,
        UPDATE,
        json!({ "input": { "pullRequestId": id, "title": title, "body": body } }),
    )?;
    Ok(answer.update_pull_request.pull_request)
}

pub fn mark_ready(
    http: &dyn HttpClient,
    token: &str,
    repository: &GitHubRepository,
    number: u64,
) -> Result<PullRequestDetails, ApiError> {
    let id = node_id(http, token, repository, number)?;
    let answer: ReadyAnswer = graphql::query(
        http,
        token,
        READY,
        json!({ "input": { "pullRequestId": id } }),
    )?;
    Ok(answer.mark_pull_request_ready_for_review.pull_request)
}

#[derive(Deserialize)]
struct IdAnswer {
    repository: Option<IdRepository>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct IdRepository {
    pull_request: Option<IdNode>,
}

#[derive(Deserialize)]
struct IdNode {
    id: String,
}

fn node_id(
    http: &dyn HttpClient,
    token: &str,
    repository: &GitHubRepository,
    number: u64,
) -> Result<String, ApiError> {
    let answer: IdAnswer = graphql::query(
        http,
        token,
        NODE_ID,
        json!({ "owner": repository.owner, "name": repository.name, "number": number }),
    )?;
    answer
        .repository
        .and_then(|repository| repository.pull_request)
        .map(|node| node.id)
        .ok_or_else(|| ApiError::GithubRequestFailed {
            message: format!("GitHub has no pull request #{number} in this repository"),
        })
}
