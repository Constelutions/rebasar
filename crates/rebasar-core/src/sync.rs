//! Fetch, pull and push, and how far the current branch is from its upstream.

use std::path::Path;

use gix::revision::walk::Sorting;
use gix::traverse::commit::simple::CommitTimeOrder;
use serde::{Deserialize, Serialize};

use crate::mutation::Mutation;
use crate::safety::Loss;
use crate::{open_worktree, outgoing, ApiError, Core, MutationOutcome};

/// Keeps counting cheap when a branch has never been pushed from a very long history.
const MAX_COUNTED_COMMITS: usize = 9999;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncStatus {
    /// `None` while HEAD is detached.
    pub branch: Option<String>,
    /// The remote-tracking branch, such as `origin/main`; `None` for a branch that was never
    /// pushed, whose commits all count as ahead.
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
}

/// How a pull joins the remote's commits with local ones.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PullStrategy {
    Merge,
    Rebase,
}

impl Core {
    pub fn sync_status(&self, worktree: &Path) -> Result<SyncStatus, ApiError> {
        let (_, repo) = open_worktree(worktree)?;
        read_status(&repo)
    }

    /// Fetches every remote. Never prompts for credentials, so a remote that needs them fails
    /// instead of waiting.
    pub fn fetch(&self, worktree: &Path) -> Result<MutationOutcome, ApiError> {
        self.run_sync(worktree, Mutation::new("Fetch", ["fetch", "--all"]))
    }

    /// Whether `pull` needs to be told how to join the branches: they have diverged and
    /// neither `pull.rebase` nor `pull.ff` says what to do.
    pub fn pull_needs_strategy(&self, worktree: &Path) -> Result<bool, ApiError> {
        let (_, repo) = open_worktree(worktree)?;
        let status = read_status(&repo)?;
        Ok(status.ahead > 0 && status.behind > 0 && !pull_is_configured(&repo))
    }

    /// Follows the user's own `pull.rebase` and `pull.ff` unless `strategy` overrides them.
    /// With `remember` the strategy is saved as `pull.rebase` in this Repository first, so it
    /// is not asked again.
    pub fn pull(
        &self,
        worktree: &Path,
        strategy: Option<PullStrategy>,
        remember: bool,
    ) -> Result<MutationOutcome, ApiError> {
        let Some(strategy) = strategy else {
            if self.pull_needs_strategy(worktree)? {
                return Err(ApiError::Unexpected {
                    message: "the branch has diverged from its upstream; choose merge or rebase"
                        .to_owned(),
                });
            }
            return self.run_sync(worktree, Mutation::new("Pull", ["pull"]));
        };

        let rebase = strategy == PullStrategy::Rebase;
        if remember {
            let value = if rebase { "true" } else { "false" };
            let saved = self.mutations.run(
                worktree,
                Mutation::new("Remember pull strategy", ["config", "pull.rebase", value]),
            )?;
            if saved != MutationOutcome::Succeeded {
                return Ok(saved);
            }
            return self.run_sync(worktree, Mutation::new("Pull", ["pull"]));
        }
        let flag = if rebase { "--rebase" } else { "--no-rebase" };
        self.run_sync(worktree, Mutation::new("Pull", ["pull", flag]))
    }

    /// A branch without an upstream is published to its remote and starts tracking it. A forced
    /// push always uses `--force-with-lease`, so it refuses to overwrite commits it has not seen.
    pub fn push(&self, worktree: &Path, force: bool) -> Result<MutationOutcome, ApiError> {
        let (_, repo) = open_worktree(worktree)?;
        let status = read_status(&repo)?;
        let remote = if status.upstream.is_none() {
            Some(default_remote(&repo)?)
        } else {
            None
        };
        drop(repo);

        let mut args = vec!["push".to_owned()];
        if force {
            args.push("--force-with-lease".to_owned());
        }
        if let Some(remote) = remote {
            args.extend(["--set-upstream".to_owned(), remote, "HEAD".to_owned()]);
        }
        let title = if force { "Force push" } else { "Push" };
        self.run_sync(worktree, Mutation::new(title, args))
    }

    fn run_sync(&self, worktree: &Path, mutation: Mutation) -> Result<MutationOutcome, ApiError> {
        let run = self.mutations.run_detailed(worktree, mutation)?;
        if matches!(run.outcome, MutationOutcome::Failed { .. }) {
            if let Some(message) = authentication_hint(&run.error_output) {
                return Err(ApiError::GitFailed { message });
            }
        }
        Ok(run.outcome)
    }
}

/// What a forced push would overwrite: the commits only the remote has.
pub(crate) fn force_push_loss(repo: &gix::Repository) -> Result<Loss, ApiError> {
    let status = read_status(repo)?;
    Ok(Loss {
        commits: if status.upstream.is_some() { status.behind } else { 0 },
        ..Loss::default()
    })
}

fn read_status(repo: &gix::Repository) -> Result<SyncStatus, ApiError> {
    let head = repo.head().map_err(ApiError::unexpected)?;
    let branch = head.referent_name().map(|name| name.shorten().to_string());
    let (Some(tip), Some(_)) = (head.id(), &branch) else {
        return Ok(SyncStatus {
            branch,
            upstream: None,
            ahead: 0,
            behind: 0,
        });
    };
    let tip = tip.detach();

    let Some((upstream, upstream_tip)) = upstream_of(repo, &head) else {
        let ahead = count(repo, tip, outgoing::remote_tips(repo)?)?;
        return Ok(SyncStatus {
            branch,
            upstream: None,
            ahead,
            behind: 0,
        });
    };
    Ok(SyncStatus {
        branch,
        upstream: Some(upstream),
        ahead: count(repo, tip, vec![upstream_tip])?,
        behind: count(repo, upstream_tip, vec![tip])?,
    })
}

fn upstream_of(repo: &gix::Repository, head: &gix::Head<'_>) -> Option<(String, gix::ObjectId)> {
    let branch = head.referent_name()?;
    let tracking = repo
        .branch_remote_tracking_ref_name(branch, gix::remote::Direction::Fetch)?
        .ok()?;
    let mut reference = repo.try_find_reference(tracking.as_ref()).ok()??;
    let tip = reference.peel_to_id().ok()?.detach();
    Some((tracking.shorten().to_string(), tip))
}

fn count(
    repo: &gix::Repository,
    tip: gix::ObjectId,
    hidden: Vec<gix::ObjectId>,
) -> Result<u32, ApiError> {
    let walk = repo
        .rev_walk([tip])
        .sorting(Sorting::ByCommitTime(CommitTimeOrder::NewestFirst))
        .with_hidden(hidden)
        .all()
        .map_err(ApiError::unexpected)?;
    let mut total = 0;
    for info in walk.take(MAX_COUNTED_COMMITS) {
        info.map_err(ApiError::unexpected)?;
        total += 1;
    }
    Ok(total)
}

fn pull_is_configured(repo: &gix::Repository) -> bool {
    let config = repo.config_snapshot();
    config.string("pull.rebase").is_some() || config.string("pull.ff").is_some()
}

fn default_remote(repo: &gix::Repository) -> Result<String, ApiError> {
    let names: Vec<String> = repo
        .remote_names()
        .into_iter()
        .map(|name| name.to_string())
        .collect();
    if names.iter().any(|name| name == "origin") {
        return Ok("origin".to_owned());
    }
    names.into_iter().next().ok_or_else(|| ApiError::Unexpected {
        message: "the Repository has no remote to push to".to_owned(),
    })
}

/// Turns the ways a remote can refuse access into steps the user can act on.
pub(crate) fn authentication_hint(error_output: &[String]) -> Option<String> {
    let output = error_output.join("\n").to_lowercase();
    let refused = [
        "authentication failed",
        "permission denied",
        "could not read username",
        "could not read password",
        "terminal prompts disabled",
        "access denied",
        "invalid credentials",
        "returned error: 403",
    ]
    .iter()
    .any(|phrase| output.contains(phrase));
    refused.then(|| {
        "The remote did not accept your credentials. Sign in again through Git Credential \
         Manager (or check that your SSH key is loaded in ssh-agent), then retry. Git's own \
         message is in the output panel."
            .to_owned()
    })
}
