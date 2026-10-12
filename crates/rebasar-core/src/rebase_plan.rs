//! Planning an interactive rebase and running it without an editor: the plan is written as the
//! todo list and `git` replays it, so the result is exactly what `git rebase -i` would give.

use std::fs;
use std::path::Path;

use gix::bstr::ByteSlice;
use serde::{Deserialize, Serialize};

use crate::mutation::Mutation;
use crate::{commit, open_worktree, ApiError, Core, MutationOutcome};

const SHORT_ID_LENGTH: usize = 7;
const MESSAGES_FOLDER: &str = "rebasar-messages";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PlanAction {
    Pick,
    /// Takes the entry's `message` as the new commit message.
    Reword,
    Squash,
    Fixup,
    Drop,
    /// Only ever read from a rebase already in progress; it cannot be chosen.
    Edit,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum RebasePlanEntry {
    Commit {
        action: PlanAction,
        commit: String,
        short_id: String,
        subject: String,
        /// The commit's message; what a `reword` replaces.
        message: String,
    },
    /// An `exec`, `break` or other todo line, kept as it is.
    Line { text: String },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RebasePlan {
    /// The commit to replay onto; `None` when rebasing a whole history from its root, and when
    /// the plan edits a rebase that is in progress.
    pub onto: Option<String>,
    /// The plan is what is left of a rebase that stopped, not a new one.
    pub in_progress: bool,
    /// Oldest first, the order the commits are replayed in.
    pub entries: Vec<RebasePlanEntry>,
}

impl Core {
    /// The commits a rebase starting at `from` would replay, oldest first, all set to `pick`.
    /// With a rebase already in progress and no `from`, what is left of its todo list.
    pub fn rebase_plan(&self, worktree: &Path, from: Option<&str>) -> Result<RebasePlan, ApiError> {
        let (_, repo) = open_worktree(worktree)?;
        let git_dir = repo.git_dir().to_path_buf();

        let Some(from) = from else {
            let todo = fs::read_to_string(git_dir.join("rebase-merge/git-rebase-todo")).map_err(
                |_| ApiError::Unexpected {
                    message: "no rebase is in progress to edit".to_owned(),
                },
            )?;
            return Ok(RebasePlan {
                onto: None,
                in_progress: true,
                entries: parse_todo(&repo, &todo)?,
            });
        };

        let start = commit::find(&repo, from)?;
        let parent = start.parent_ids().next().map(|id| id.detach());
        let head = repo.head_id().map_err(ApiError::unexpected)?;

        let walk = repo
            .rev_walk([head.detach()])
            .with_hidden(parent)
            .all()
            .map_err(ApiError::unexpected)?;
        let mut entries = Vec::new();
        let mut reaches_start = false;
        for info in walk {
            let info = info.map_err(ApiError::unexpected)?;
            reaches_start |= info.id == start.id;
            let found = info.object().map_err(ApiError::unexpected)?;
            // A rebase without `--rebase-merges` leaves merge commits out of the todo list.
            if found.parent_ids().count() > 1 {
                continue;
            }
            entries.push(commit_entry(&repo, info.id, PlanAction::Pick)?);
        }
        if !reaches_start {
            return Err(ApiError::Unexpected {
                message: "that commit is not part of the current branch".to_owned(),
            });
        }
        entries.reverse();
        Ok(RebasePlan {
            onto: parent.map(|id| id.to_string()),
            in_progress: false,
            entries,
        })
    }

    /// Replays the plan. A plan that stops on a conflict leaves the Worktree paused for the
    /// Operation in progress banner.
    pub fn apply_rebase_plan(
        &self,
        worktree: &Path,
        plan: &RebasePlan,
    ) -> Result<MutationOutcome, ApiError> {
        let (_, repo) = open_worktree(worktree)?;
        let git_dir = repo.git_dir().to_path_buf();
        drop(repo);

        let todo = todo_text(&git_dir, plan)?;
        let todo_file = git_dir.join("rebasar-todo");
        fs::write(&todo_file, todo).map_err(ApiError::unexpected)?;

        let editor = format!("cp '{}'", shell_path(&todo_file));
        let mut args = vec!["rebase".to_owned()];
        if plan.in_progress {
            args.push("--edit-todo".to_owned());
        } else {
            args.push("--interactive".to_owned());
            match &plan.onto {
                Some(onto) => {
                    require_commit_id(onto)?;
                    args.push(onto.clone());
                }
                None => args.push("--root".to_owned()),
            }
        }
        self.mutations.run(
            worktree,
            Mutation::new("Interactive rebase", args).with_env("GIT_SEQUENCE_EDITOR", editor),
        )
    }
}

fn commit_entry(
    repo: &gix::Repository,
    id: gix::ObjectId,
    action: PlanAction,
) -> Result<RebasePlanEntry, ApiError> {
    let found = repo.find_commit(id).map_err(ApiError::unexpected)?;
    let message = found.message_raw_sloppy().to_str_lossy().into_owned();
    let subject = message.lines().next().unwrap_or_default().to_owned();
    Ok(RebasePlanEntry::Commit {
        action,
        commit: id.to_string(),
        short_id: id.to_hex_with_len(SHORT_ID_LENGTH).to_string(),
        subject,
        message: message.trim_end().to_owned(),
    })
}

fn parse_todo(repo: &gix::Repository, todo: &str) -> Result<Vec<RebasePlanEntry>, ApiError> {
    let mut entries = Vec::new();
    for line in todo.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let (word, rest) = line.split_once(char::is_whitespace).unwrap_or((line, ""));
        let action = match word {
            "pick" | "p" => Some(PlanAction::Pick),
            "reword" | "r" => Some(PlanAction::Reword),
            "squash" | "s" => Some(PlanAction::Squash),
            "fixup" | "f" => Some(PlanAction::Fixup),
            "drop" | "d" => Some(PlanAction::Drop),
            "edit" | "e" => Some(PlanAction::Edit),
            _ => None,
        };
        let abbreviation = rest.split_whitespace().next().unwrap_or_default();
        match action {
            Some(action) if !abbreviation.starts_with('-') => {
                let id = repo
                    .rev_parse_single(abbreviation)
                    .map_err(ApiError::unexpected)?
                    .detach();
                entries.push(commit_entry(repo, id, action)?);
            }
            _ => entries.push(RebasePlanEntry::Line {
                text: line.to_owned(),
            }),
        }
    }
    Ok(entries)
}

fn todo_text(git_dir: &Path, plan: &RebasePlan) -> Result<String, ApiError> {
    let messages = git_dir.join(MESSAGES_FOLDER);
    let _ = fs::remove_dir_all(&messages);

    let mut todo = String::new();
    for (index, entry) in plan.entries.iter().enumerate() {
        match entry {
            RebasePlanEntry::Line { text } => todo.push_str(&format!("{text}\n")),
            RebasePlanEntry::Commit {
                action: PlanAction::Edit,
                commit,
                ..
            } => {
                require_commit_id(commit)?;
                todo.push_str(&format!("edit {commit}\n"));
            }
            RebasePlanEntry::Commit {
                action,
                commit,
                message,
                ..
            } => {
                require_commit_id(commit)?;
                let word = match action {
                    PlanAction::Reword => "pick",
                    PlanAction::Pick => "pick",
                    PlanAction::Squash => "squash",
                    PlanAction::Fixup => "fixup",
                    PlanAction::Drop => "drop",
                    PlanAction::Edit => unreachable!("handled above"),
                };
                todo.push_str(&format!("{word} {commit}\n"));
                if *action == PlanAction::Reword {
                    // The editor is disabled, so the new message is applied by a step of its
                    // own right after the commit is replayed.
                    fs::create_dir_all(&messages).map_err(ApiError::unexpected)?;
                    let file = messages.join(format!("{index}.txt"));
                    fs::write(&file, message).map_err(ApiError::unexpected)?;
                    todo.push_str(&format!(
                        "exec git commit --amend --allow-empty --file '{}'\n",
                        shell_path(&file)
                    ));
                }
            }
        }
    }
    Ok(todo)
}

/// `sh` takes forward slashes on every platform, including for `C:` paths.
fn shell_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/").replace('\'', "'\\''")
}

/// Anything else could be read by `git` as an option or as a name that resolves elsewhere.
fn require_commit_id(commit: &str) -> Result<(), ApiError> {
    let is_id = matches!(commit.len(), 40 | 64) && commit.bytes().all(|b| b.is_ascii_hexdigit());
    if is_id {
        return Ok(());
    }
    Err(ApiError::Unexpected {
        message: format!("{commit} is not a commit id"),
    })
}
