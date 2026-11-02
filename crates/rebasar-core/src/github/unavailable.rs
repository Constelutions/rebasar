use serde::Serialize;

use crate::ApiError;

/// Why the Pull requests of a Repository cannot be shown.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum UnavailableReason {
    NoRemotes,
    NotGithub { host: String },
    UnexpectedPath { path: String },
    AliasUnresolved { alias: String, detail: String },
    NoToken,
    TokenRejected,
    RepositoryNotVisible { repository: String },
    RequestFailed { message: String },
}

impl UnavailableReason {
    /// `url` is the remote that was looked at, when there was one.
    pub fn into_error(self, url: Option<String>) -> ApiError {
        ApiError::PullRequestsUnavailable {
            message: self.message(),
            hint: self.hint(),
            reason: self,
            url,
        }
    }

    fn message(&self) -> String {
        match self {
            Self::NoRemotes => "This Repository has no remotes.".to_owned(),
            Self::NotGithub { host } => format!("The remote ({host}) is not on GitHub."),
            Self::UnexpectedPath { path } => {
                format!("The remote's path ({path}) is not of the form Owner/Repository.")
            }
            Self::AliasUnresolved { alias, detail } => {
                format!("Could not resolve the SSH host alias {alias}: {detail}")
            }
            Self::NoToken => "You are not signed in to GitHub.".to_owned(),
            Self::TokenRejected => "GitHub did not accept the token.".to_owned(),
            Self::RepositoryNotVisible { repository } => {
                format!("GitHub has no Repository {repository} visible to this token.")
            }
            Self::RequestFailed { message } => message.clone(),
        }
    }

    fn hint(&self) -> Option<String> {
        match self {
            Self::NoRemotes => {
                Some("Add the GitHub remote with `git remote add origin <url>`.".to_owned())
            }
            Self::NotGithub { .. } => None,
            Self::UnexpectedPath { .. } => {
                Some("Use a remote such as git@github.com:Owner/Repository.git.".to_owned())
            }
            Self::AliasUnresolved { alias, .. } => Some(format!(
                "Check the Host entry for {alias} in your SSH configuration; `ssh -G {alias}` shows how it resolves."
            )),
            Self::NoToken => {
                Some("Run `gh auth login`, or paste a personal access token.".to_owned())
            }
            Self::TokenRejected => Some(
                "Run `gh auth login` again, or paste a new personal access token.".to_owned(),
            ),
            Self::RepositoryNotVisible { .. } => Some(
                "Check the remote's spelling, and that the token can read this Repository."
                    .to_owned(),
            ),
            Self::RequestFailed { .. } => {
                Some("Check your network connection and try again.".to_owned())
            }
        }
    }
}
