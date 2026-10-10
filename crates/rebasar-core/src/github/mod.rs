use std::sync::Arc;

use serde::Serialize;

use crate::platform::{self, CredentialStore};
use crate::ApiError;

mod gh_cli;
mod graphql;
mod http;
mod pull_requests;
mod remote;

pub use gh_cli::{GhCli, SystemGhCli};
pub use http::{HttpClient, HttpError, HttpRequest, HttpResponse, UreqHttpClient};
pub use pull_requests::{CheckState, PullRequest, ReviewState};
pub(crate) use remote::find as find_remote;

const TOKEN_ACCOUNT: &str = "github-token";

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubRepository {
    pub owner: String,
    pub name: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum TokenSource {
    GhCli,
    PersonalAccessToken,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubAuthStatus {
    pub source: Option<TokenSource>,
}

/// Everything the GitHub client reaches outside the process for.
pub struct GitHubServices {
    pub http: Arc<dyn HttpClient>,
    pub credentials: Arc<dyn CredentialStore>,
    pub gh_cli: Arc<dyn GhCli>,
}

impl GitHubServices {
    pub fn system() -> Self {
        Self {
            http: Arc::new(UreqHttpClient::new()),
            credentials: platform::os_credential_store(),
            gh_cli: Arc::new(SystemGhCli),
        }
    }
}

pub(crate) struct GitHub {
    services: GitHubServices,
}

impl GitHub {
    pub fn new(services: GitHubServices) -> Self {
        Self { services }
    }

    pub fn auth_status(&self) -> Result<GitHubAuthStatus, ApiError> {
        Ok(GitHubAuthStatus {
            source: self.token()?.map(|(source, _)| source),
        })
    }

    pub fn sign_in(&self, token: &str) -> Result<GitHubAuthStatus, ApiError> {
        let token = token.trim();
        if token.is_empty() {
            return Err(ApiError::GithubTokenRejected);
        }
        graphql::check_token(self.services.http.as_ref(), token)?;
        self.services
            .credentials
            .save(TOKEN_ACCOUNT, token)
            .map_err(ApiError::unexpected)?;
        self.auth_status()
    }

    pub fn sign_out(&self) -> Result<GitHubAuthStatus, ApiError> {
        self.services
            .credentials
            .delete(TOKEN_ACCOUNT)
            .map_err(ApiError::unexpected)?;
        self.auth_status()
    }

    pub fn pull_requests(
        &self,
        repository: &GitHubRepository,
    ) -> Result<Vec<PullRequest>, ApiError> {
        let (_, token) = self.token()?.ok_or(ApiError::GithubNotSignedIn)?;
        pull_requests::list(self.services.http.as_ref(), &token, repository)
    }

    fn token(&self) -> Result<Option<(TokenSource, String)>, ApiError> {
        if let Some(token) = self.services.gh_cli.token() {
            return Ok(Some((TokenSource::GhCli, token)));
        }
        let stored = self
            .services
            .credentials
            .read(TOKEN_ACCOUNT)
            .map_err(ApiError::unexpected)?;
        Ok(stored.map(|token| (TokenSource::PersonalAccessToken, token)))
    }
}
