use std::collections::BTreeSet;

use gix::remote::Direction;
use gix::url::Scheme;

use super::{GitHubRepository, SshResolver, UnavailableReason};
use crate::ApiError;

/// The GitHub Repository a remote points to, and the address it was found at.
pub(crate) struct Remote {
    pub repository: GitHubRepository,
    pub url: String,
}

impl Remote {
    /// Turns a failure of a GitHub call about this remote into the reason shown to the user.
    pub fn explain(&self, error: ApiError) -> ApiError {
        let url = Some(self.url.clone());
        match error {
            ApiError::GithubTokenRejected => UnavailableReason::TokenRejected.into_error(url),
            ApiError::GithubRequestFailed { message } => {
                UnavailableReason::RequestFailed { message }.into_error(url)
            }
            ApiError::PullRequestsUnavailable { reason, .. } => reason.into_error(url),
            other => other,
        }
    }
}

struct Problem {
    reason: UnavailableReason,
    url: String,
}

/// `origin` wins, so a fork's `upstream` or a mirror never hides the Repository's own remote.
/// Remote URLs are read as Git reads them, `insteadOf` rewrites included.
pub(crate) fn find(repo: &gix::Repository, ssh: &dyn SshResolver) -> Result<Remote, ApiError> {
    let names: BTreeSet<String> = repo
        .remote_names()
        .into_iter()
        .map(|name| name.to_string())
        .collect();
    let origin_first = names
        .iter()
        .filter(|name| name.as_str() == "origin")
        .chain(names.iter().filter(|name| name.as_str() != "origin"));

    let mut problems = Vec::new();
    for name in origin_first {
        let Ok(remote) = repo.find_remote(name.as_str()) else {
            continue;
        };
        let Some(url) = remote.url(Direction::Fetch) else {
            continue;
        };
        let shown = shown(url);
        match read(url, ssh) {
            Ok(repository) => {
                return Ok(Remote {
                    repository,
                    url: shown,
                })
            }
            Err(reason) => problems.push(Problem { reason, url: shown }),
        }
    }

    // An alias that failed to resolve is the one the user can act on; "not GitHub" may just be
    // the Repository's other remote.
    let culprit = match problems
        .iter()
        .position(|problem| matches!(problem.reason, UnavailableReason::AliasUnresolved { .. }))
    {
        Some(index) => Some(problems.swap_remove(index)),
        None => problems.into_iter().next(),
    };
    Err(match culprit {
        Some(problem) => problem.reason.into_error(Some(problem.url)),
        None => UnavailableReason::NoRemotes.into_error(None),
    })
}

fn read(url: &gix::Url, ssh: &dyn SshResolver) -> Result<GitHubRepository, UnavailableReason> {
    let Some(host) = url.host() else {
        return Err(UnavailableReason::NotGithub { host: shown(url) });
    };

    let hostname = if is_github(host) || url.scheme != Scheme::Ssh {
        host.to_owned()
    } else {
        ssh.hostname(host)
            .map_err(|detail| UnavailableReason::AliasUnresolved {
                alias: host.to_owned(),
                detail,
            })?
    };
    if !is_github(&hostname) {
        return Err(UnavailableReason::NotGithub { host: hostname });
    }

    let path = url.path.to_string();
    let path = path.trim_matches('/');
    let path = path.strip_suffix(".git").unwrap_or(path);
    match path.split_once('/') {
        Some((owner, name)) if !owner.is_empty() && !name.is_empty() && !name.contains('/') => {
            Ok(GitHubRepository {
                owner: owner.to_owned(),
                name: name.to_owned(),
            })
        }
        _ => Err(UnavailableReason::UnexpectedPath {
            path: path.to_owned(),
        }),
    }
}

fn is_github(host: &str) -> bool {
    host.eq_ignore_ascii_case("github.com") || host.eq_ignore_ascii_case("ssh.github.com")
}

/// The address without anything secret in it: tokens are commonly embedded as the user or the
/// password of an `https` remote.
fn shown(url: &gix::Url) -> String {
    let mut url = url.clone();
    url.set_password(None);
    if url.scheme != Scheme::Ssh {
        url.set_user(None);
    }
    url.to_bstring().to_string()
}
