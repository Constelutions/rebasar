use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use thiserror::Error;

mod adding;
mod branches;
mod commit;
mod conflicts;
mod commit_actions;
mod compare;
mod diff;
mod git_setup;
pub mod github;
mod history;
mod identity;
mod mutation;
mod operation;
mod outgoing;
pub mod platform;
mod poll;
pub mod query;
mod rebase_plan;
mod safety;
mod registry;
mod repositories;
mod session;
mod settings;
mod staging;
mod stash;
mod status;
mod sync;
mod tabs;
mod tags_remotes;
mod watch;
mod worktrees;

pub use adding::FoundRepository;
pub use branches::{BranchInfo, BranchKind, MergeMode};
pub use commit::{CommitDetail, CommitParent};
pub use rebase_plan::{PlanAction, RebasePlan, RebasePlanEntry};
pub use conflicts::{ConflictFile, ConflictKind, ConflictSegment, ConflictSide};
pub use commit_actions::ResetMode;
pub use compare::WorktreeDiffRequest;
pub use diff::{
    ChangeList, CommitDiffRequest, DiffContent, DiffLine, DiffRequest, FileDiff, Hunk, LineKind,
    ModeChange, WhitespaceMode,
};
pub use github::{
    CheckState, GitHubAuthStatus, GitHubRepository, PullRequest, ReviewState, TokenSource,
};
use github::{GitHub, GitHubServices};
pub use git_setup::{GitSetup, GitVersion, MINIMUM_GIT_VERSION};
use mutation::{Mutation, MutationRunner};
pub use mutation::{MutationId, MutationInfo, MutationOutcome, OutputStream};
pub use operation::{OperationInProgress, OperationKind, OperationStep};
pub use outgoing::OutgoingCommit;
pub use identity::GitIdentity;
pub use safety::{Assessment, Loss, MutationKind};
pub use settings::{AppearanceSettings, DiffMode, DiffSettings, Settings, SyncSettings};
use registry::RegistryStore;
use staging::Direction;
pub use staging::LineSelection;
pub use registry::{Group, WindowBounds};
pub use repositories::{RepositoryEntry, RepositoryList, WorktreeEntry};
pub use session::Session;
pub use status::{ChangeKind, FileChange, WorktreeStatus};
pub use stash::{StashInfo, StashPreview};
pub use tags_remotes::{RemoteInfo, TagInfo};
pub use worktrees::{WorktreeDetail, WorktreeStart};
pub use sync::{PullStrategy, SyncStatus};
pub use tabs::CacheKind;
use tabs::Registry;

pub use history::{
    CommitHit, Edge, EdgeKind, HistoryCount, HistoryFilter, HistoryPage, HistoryRow, RefKind,
    RefLabel,
};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Tab {
    pub repository_name: String,
    pub worktree_path: String,
    pub head: Head,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Head {
    Branch { name: String },
    Detached { commit: String },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum CoreEvent {
    TabOpened {
        tab: Tab,
    },
    /// The core closed the Tab, because its Repository went missing or was removed.
    TabClosed {
        worktree_path: String,
    },
    WorktreeChanged {
        worktree_path: String,
    },
    /// The Tabs that are checked periodically instead of watched live, most recently used
    /// first. Sent whenever the list changes, including when it becomes empty again.
    PollingTabsChanged {
        worktree_paths: Vec<String>,
    },
    MutationQueued {
        mutation: MutationInfo,
    },
    MutationStarted {
        mutation_id: MutationId,
    },
    /// One line of `git` output, hooks included. A `transient` line is a progress update that
    /// the next line replaces.
    MutationOutput {
        mutation_id: MutationId,
        stream: OutputStream,
        text: String,
        transient: bool,
    },
    MutationFinished {
        mutation_id: MutationId,
        outcome: MutationOutcome,
    },
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct CommitOptions {
    /// Replaces the previous commit instead of adding a new one.
    pub amend: bool,
    pub sign_off: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Error, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ApiError {
    #[error("{path} does not exist")]
    FolderNotFound { path: String },
    #[error("{path} is not a Git repository")]
    NotARepository { path: String },
    #[error("{path} has no GitHub remote")]
    NotGithub { path: String },
    #[error("not signed in to GitHub")]
    GithubNotSignedIn,
    #[error("GitHub rejected the token")]
    GithubTokenRejected,
    #[error("{message}")]
    GithubRequestFailed { message: String },
    #[error("{message}")]
    InvalidQuery {
        message: String,
        start: usize,
        end: usize,
    },
    #[error("there is no Group {id}")]
    GroupNotFound { id: String },
    #[error("{path} is not a known Repository")]
    RepositoryNotFound { path: String },
    #[error("a Group needs a name")]
    InvalidGroupName,
    #[error("{path} is already a Git repository")]
    AlreadyARepository { path: String },
    #[error("cannot tell the name of a Repository from {url:?}")]
    InvalidRepositoryUrl { url: String },
    #[error("{message}")]
    GitFailed { message: String },
    #[error("{message}")]
    Unexpected { message: String },
}

impl From<query::QueryError> for ApiError {
    fn from(error: query::QueryError) -> Self {
        Self::InvalidQuery {
            message: error.message,
            start: error.start,
            end: error.end,
        }
    }
}

impl ApiError {
    pub fn unexpected(error: impl std::error::Error) -> Self {
        Self::Unexpected {
            message: error.to_string(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct CoreSettings {
    /// How many Worktrees get a live file watcher; the least recently used Tabs beyond it are
    /// polled instead. The default sits above any realistic number of Tabs, so in practice the
    /// limit that applies is the one the operating system reports.
    pub watch_limit: usize,
    /// How many of the most recently used Tabs keep their graph and diff caches.
    pub cached_tabs: usize,
    pub poll_interval: Duration,
    /// How long a background Tab's changes must settle before they are reported.
    pub background_quiet: Duration,
}

impl Default for CoreSettings {
    fn default() -> Self {
        Self {
            watch_limit: 128,
            cached_tabs: 1,
            poll_interval: Duration::from_secs(5),
            background_quiet: Duration::from_secs(1),
        }
    }
}

pub struct Core {
    on_event: Arc<dyn Fn(CoreEvent) + Send + Sync>,
    tabs: Mutex<Registry>,
    histories: Mutex<HashMap<PathBuf, Arc<Mutex<history::Layout>>>>,
    totals: Mutex<HashMap<PathBuf, (u64, usize)>>,
    github: GitHub,
    mutations: MutationRunner,
    config_dir: Option<PathBuf>,
    settings_write: Mutex<()>,
    registry: RegistryStore,
}

impl Core {
    pub fn new(on_event: impl Fn(CoreEvent) + Send + Sync + 'static) -> Self {
        Self::build(CoreSettings::default(), GitHubServices::system(), on_event)
    }

    pub fn with_settings(
        settings: CoreSettings,
        on_event: impl Fn(CoreEvent) + Send + Sync + 'static,
    ) -> Self {
        Self::build(settings, GitHubServices::system(), on_event)
    }

    pub fn with_github(
        on_event: impl Fn(CoreEvent) + Send + Sync + 'static,
        github: GitHubServices,
    ) -> Self {
        Self::build(CoreSettings::default(), github, on_event)
    }

    fn build(
        settings: CoreSettings,
        github: GitHubServices,
        on_event: impl Fn(CoreEvent) + Send + Sync + 'static,
    ) -> Self {
        let on_event: Arc<dyn Fn(CoreEvent) + Send + Sync> = Arc::new(on_event);
        Self {
            mutations: MutationRunner::new(Arc::clone(&on_event)),
            tabs: Mutex::new(Registry::new(settings, Arc::clone(&on_event))),
            registry: RegistryStore::in_memory(),
            on_event,
            histories: Mutex::new(HashMap::new()),
            totals: Mutex::new(HashMap::new()),
            github: GitHub::new(github),
            config_dir: None,
            settings_write: Mutex::new(()),
        }
    }

    pub fn check_git(&self) -> GitSetup {
        GitSetup::check()
    }

    /// Stages the whole files, deletions included. Blocks until the mutation has finished.
    pub fn stage(&self, worktree: &Path, paths: &[String]) -> Result<MutationOutcome, ApiError> {
        // `git add --all --` without paths would stage the entire working tree.
        if paths.is_empty() {
            return Ok(MutationOutcome::Succeeded);
        }
        let args = ["--literal-pathspecs", "add", "--all", "--"]
            .into_iter()
            .chain(paths.iter().map(String::as_str));
        self.mutations
            .run(worktree, Mutation::new(files_title("Stage", paths), args))
    }

    /// Removes the whole files from the index. For a renamed file pass both its paths.
    pub fn unstage(&self, worktree: &Path, paths: &[String]) -> Result<MutationOutcome, ApiError> {
        // `git reset` without paths would unstage everything.
        if paths.is_empty() {
            return Ok(MutationOutcome::Succeeded);
        }
        let args = ["--literal-pathspecs", "reset", "--quiet", "--"]
            .into_iter()
            .chain(paths.iter().map(String::as_str));
        self.mutations
            .run(worktree, Mutation::new(files_title("Unstage", paths), args))
    }

    /// Stages only the lines picked in the diff of the file. Fails without changing anything when
    /// the file no longer matches the diff the lines were picked from.
    pub fn stage_lines(
        &self,
        worktree: &Path,
        selection: &LineSelection,
    ) -> Result<MutationOutcome, ApiError> {
        self.apply_lines(worktree, selection, Direction::Stage)
    }

    /// Takes only the lines picked in the diff of the staged file out of the index again.
    pub fn unstage_lines(
        &self,
        worktree: &Path,
        selection: &LineSelection,
    ) -> Result<MutationOutcome, ApiError> {
        self.apply_lines(worktree, selection, Direction::Unstage)
    }

    fn apply_lines(
        &self,
        worktree: &Path,
        selection: &LineSelection,
        direction: Direction,
    ) -> Result<MutationOutcome, ApiError> {
        let (_, repo) = open_worktree(worktree)?;
        let Some(patch) = staging::patch_for(&repo, selection, direction)? else {
            return Ok(MutationOutcome::Succeeded);
        };
        drop(repo);

        let verb = match direction {
            Direction::Stage => "Stage",
            Direction::Unstage => "Unstage",
        };
        let title = format!(
            "{verb} {} of {}",
            lines_title(selection.lines.len()),
            selection.path
        );
        let args = ["apply", "--cached", "--whitespace=nowarn", "--", "-"];
        self.mutations
            .run(worktree, Mutation::new(title, args).with_stdin(patch))
    }

    /// An amend with an empty `message` keeps the previous commit's message.
    pub fn commit(
        &self,
        worktree: &Path,
        message: &str,
        options: CommitOptions,
    ) -> Result<MutationOutcome, ApiError> {
        let mut args = vec!["commit"];
        if options.amend {
            args.push("--amend");
        }
        if options.sign_off {
            args.push("--signoff");
        }
        if options.amend && message.trim().is_empty() {
            args.push("--no-edit");
        } else {
            args.extend(["--message", message]);
        }
        let title = if options.amend {
            "Amend commit"
        } else {
            "Commit"
        };
        self.mutations.run(worktree, Mutation::new(title, args))
    }

    /// The commits on the current branch that are not on its upstream yet, newest first.
    pub fn outgoing_commits(&self, worktree: &Path) -> Result<Vec<OutgoingCommit>, ApiError> {
        let (_, repo) = open_worktree(worktree)?;
        outgoing::read(&repo)
    }

    /// Whether the Mutation can lose work and, if so, exactly what it would lose right now.
    /// The UI asks this before every Mutation that might be destructive and confirms with the
    /// user when the answer is [`Assessment::Destructive`].
    pub fn assess_mutation(
        &self,
        worktree: &Path,
        kind: &MutationKind,
    ) -> Result<Assessment, ApiError> {
        let (_, repo) = open_worktree(worktree)?;
        safety::assess(&repo, kind)
    }

    /// Throws away the unstaged changes to the given files: tracked files go back to what the
    /// index holds, untracked files are deleted. Paths that have no unstaged change, staged
    /// changes and conflicted files are left alone. Blocks until the mutations have finished
    /// and returns the first outcome that is not a success.
    pub fn discard_changes(
        &self,
        worktree: &Path,
        paths: &[String],
    ) -> Result<MutationOutcome, ApiError> {
        let (_, repo) = open_worktree(worktree)?;
        let files = safety::discardable(&repo, paths)?;
        drop(repo);

        let mut tracked = Vec::new();
        let mut untracked = Vec::new();
        for change in files {
            if change.kind == ChangeKind::Untracked {
                untracked.push(change.path);
            } else {
                tracked.push(change.path);
            }
        }
        let steps = [
            (tracked, ["restore", "--worktree", "--"]),
            (untracked, ["clean", "--force", "--"]),
        ];
        for (group, command) in steps {
            for batch in batches(&group) {
                let args = ["--literal-pathspecs"]
                    .into_iter()
                    .chain(command)
                    .chain(batch.iter().map(String::as_str));
                let outcome = self
                    .mutations
                    .run(worktree, Mutation::new(files_title("Discard", batch), args))?;
                if outcome != MutationOutcome::Succeeded {
                    return Ok(outcome);
                }
            }
        }
        Ok(MutationOutcome::Succeeded)
    }

    /// Ends a queued or running mutation. Does nothing for one that has already finished.
    pub fn cancel_mutation(&self, id: MutationId) {
        self.mutations.cancel(id);
    }

    /// The folder holding the app's own files; settings need one.
    pub fn with_config_dir(mut self, config_dir: PathBuf) -> Self {
        self.config_dir = Some(config_dir);
        self
    }

    pub fn settings(&self) -> Result<Settings, ApiError> {
        Ok(settings::read(self.config_dir()?))
    }

    /// Replaces the stored settings and returns them as stored, with out-of-range values
    /// brought back into range.
    pub fn update_settings(&self, new_settings: &Settings) -> Result<Settings, ApiError> {
        let config_dir = self.config_dir()?;
        let _writing = self.settings_write.lock().expect("settings write lock");
        settings::write(config_dir, new_settings.clone())
    }

    /// The identity in the user's global Git configuration.
    pub fn git_identity(&self) -> Result<GitIdentity, ApiError> {
        identity::read()
    }

    /// Writes the identity to the global Git configuration; a blank value removes it.
    pub fn set_git_identity(&self, new_identity: &GitIdentity) -> Result<GitIdentity, ApiError> {
        identity::write(new_identity)
    }

    fn config_dir(&self) -> Result<&Path, ApiError> {
        self.config_dir
            .as_deref()
            .ok_or_else(|| ApiError::Unexpected {
                message: "no config folder was set for the app".to_owned(),
            })
    }

    /// Remembers Repositories, Groups, open Tabs, the layout and settings in `file`, loading
    /// what an earlier run left there. Without it nothing outlives the process.
    pub fn with_registry_file(mut self, file: PathBuf) -> Self {
        self.registry = RegistryStore::load(file);
        self
    }

    /// Emits [`CoreEvent::WorktreeChanged`] after files change under the Worktree, whoever
    /// changed them. Watching an already watched Worktree does nothing; a new one becomes the
    /// most recently used Tab.
    pub fn watch_worktree(&self, path: &Path) -> Result<(), ApiError> {
        let (worktree_path, repo) = open_worktree(path)?;
        self.with_tabs(|tabs| {
            if tabs.contains(&worktree_path) {
                return Ok(());
            }
            tabs.register(worktree_path, &repo)
        })
    }

    pub fn unwatch_worktree(&self, path: &Path) {
        if let Ok(worktree_path) = platform::canonical(path) {
            self.with_tabs(|tabs| tabs.remove(&worktree_path));
        }
    }

    /// Makes the Tab the most recently used one: it keeps its caches and a live watcher, and the
    /// Tabs used least recently lose theirs.
    pub fn activate_tab(&self, path: &Path) -> Result<(), ApiError> {
        self.watch_worktree(path)?;
        let worktree_path = platform::canonical(path).map_err(ApiError::unexpected)?;
        self.with_tabs(|tabs| tabs.touch(&worktree_path));
        let worktree_path = worktree_path.to_string_lossy().into_owned();
        self.registry
            .remember(|data| data.active_tab = Some(worktree_path));
        Ok(())
    }

    /// Keeps `value` for the Tab until it is evicted. Returns `false`, keeping nothing, when the
    /// Tab is not among the most recently used ones that may hold caches.
    pub fn store_cache<T: std::any::Any + Send + Sync>(
        &self,
        path: &Path,
        kind: CacheKind,
        value: T,
    ) -> bool {
        let Ok(worktree_path) = platform::canonical(path) else {
            return false;
        };
        self.with_tabs(|tabs| tabs.store_cache(&worktree_path, kind, Arc::new(value)))
    }

    pub fn cache<T: std::any::Any + Send + Sync>(
        &self,
        path: &Path,
        kind: CacheKind,
    ) -> Option<Arc<T>> {
        let worktree_path = platform::canonical(path).ok()?;
        let cached = self.with_tabs(|tabs| tabs.cache(&worktree_path, kind))?;
        cached.downcast().ok()
    }

    /// Runs `action` on the Tab registry, then reports any change in which Tabs are polled once
    /// the lock is released, so that event handlers can call back into the core.
    fn with_tabs<T>(&self, action: impl FnOnce(&mut Registry) -> T) -> T {
        let (result, polling_change) = {
            let mut tabs = self.tabs.lock().expect("tab registry lock");
            let result = action(&mut tabs);
            (result, tabs.take_polling_change())
        };
        if let Some(event) = polling_change {
            (self.on_event)(event);
        }
        result
    }

    /// The Tab for an already open Worktree, read afresh so that a branch switched outside the
    /// app shows. Unlike [`Core::open_folder`] it announces nothing.
    pub fn refresh_tab(&self, path: &Path) -> Result<Tab, ApiError> {
        let (worktree_path, repo) = open_worktree(path)?;
        let tab = read_tab(&repo, &worktree_path)?;
        let repository = repository_folder(&repo)?.to_string_lossy().into_owned();
        self.registry.remember(|data| {
            let is_open = data
                .open_tabs
                .iter()
                .any(|open| open.tab.worktree_path == tab.worktree_path);
            if is_open {
                data.remember_tab(&tab, &repository);
            }
        });
        Ok(tab)
    }

    pub fn github_remote(&self, path: &Path) -> Result<Option<GitHubRepository>, ApiError> {
        let (_, repo) = open_worktree(path)?;
        Ok(github::find_remote(&repo))
    }

    pub fn github_auth_status(&self) -> Result<GitHubAuthStatus, ApiError> {
        self.github.auth_status()
    }

    /// Checks the token with GitHub before keeping it in the credential store. The token is
    /// only for the GitHub API; `git` keeps using its own credentials.
    pub fn sign_in_to_github(&self, token: &str) -> Result<GitHubAuthStatus, ApiError> {
        self.github.sign_in(token)
    }

    /// Forgets the stored token. A `gh` CLI sign-in is the user's and stays.
    pub fn sign_out_of_github(&self) -> Result<GitHubAuthStatus, ApiError> {
        self.github.sign_out()
    }

    pub fn pull_requests(&self, path: &Path) -> Result<Vec<PullRequest>, ApiError> {
        let (worktree_path, repo) = open_worktree(path)?;
        let repository = github::find_remote(&repo).ok_or_else(|| ApiError::NotGithub {
            path: worktree_path.to_string_lossy().into_owned(),
        })?;
        self.github.pull_requests(&repository)
    }

    pub fn worktree_status(&self, path: &Path) -> Result<WorktreeStatus, ApiError> {
        let (_, repo) = open_worktree(path)?;
        status::read(&repo)
    }

    pub fn file_diff(&self, path: &Path, request: &DiffRequest) -> Result<FileDiff, ApiError> {
        let (_, repo) = open_worktree(path)?;
        diff::read(&repo, request)
    }

    pub fn commit_file_diff(
        &self,
        path: &Path,
        request: &CommitDiffRequest,
    ) -> Result<FileDiff, ApiError> {
        let (_, repo) = open_worktree(path)?;
        diff::read_in_commit(&repo, request)
    }

    pub fn open_folder(&self, path: &Path) -> Result<Tab, ApiError> {
        let (worktree_path, repo) = open_worktree(path)?;
        let tab = read_tab(&repo, &worktree_path)?;
        let repository = repository_folder(&repo)?.to_string_lossy().into_owned();
        self.registry.remember(|data| {
            data.register_repository(&repository, &tab.repository_name, None);
            data.remember_tab(&tab, &repository);
        });
        (self.on_event)(CoreEvent::TabOpened { tab: tab.clone() });
        Ok(tab)
    }
}

fn read_tab(repo: &gix::Repository, worktree_path: &Path) -> Result<Tab, ApiError> {
    Ok(Tab {
        repository_name: folder_name(&repository_folder(repo)?),
        worktree_path: worktree_path.to_string_lossy().into_owned(),
        head: read_head(repo)?,
    })
}

fn read_head(repo: &gix::Repository) -> Result<Head, ApiError> {
    Ok(match repo.head_name().map_err(ApiError::unexpected)? {
        Some(name) => Head::Branch {
            name: name.shorten().to_string(),
        },
        None => Head::Detached {
            commit: repo
                .head_id()
                .map_err(ApiError::unexpected)?
                .to_hex_with_len(7)
                .to_string(),
        },
    })
}

/// Windows rejects command lines over 32,767 characters, which a discard of thousands of files
/// would exceed in one `git` call.
const MAX_PATHS_CHARS_PER_COMMAND: usize = 16_000;

fn batches(paths: &[String]) -> Vec<&[String]> {
    let mut batches = Vec::new();
    let mut start = 0;
    let mut chars = 0;
    for (index, path) in paths.iter().enumerate() {
        let cost = path.len() + 1;
        if index > start && chars + cost > MAX_PATHS_CHARS_PER_COMMAND {
            batches.push(&paths[start..index]);
            start = index;
            chars = 0;
        }
        chars += cost;
    }
    if start < paths.len() {
        batches.push(&paths[start..]);
    }
    batches
}

fn files_title(verb: &str, paths: &[String]) -> String {
    match paths {
        [only] => format!("{verb} {only}"),
        _ => format!("{verb} {} files", paths.len()),
    }
}

fn lines_title(count: usize) -> String {
    match count {
        1 => "1 line".to_owned(),
        _ => format!("{count} lines"),
    }
}

/// The folder of the main Worktree, however the Repository was reached.
fn repository_folder(repo: &gix::Repository) -> Result<PathBuf, ApiError> {
    let common_dir = platform::canonical(repo.common_dir()).map_err(ApiError::unexpected)?;
    common_dir
        .parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| ApiError::NotARepository {
            path: common_dir.to_string_lossy().into_owned(),
        })
}

fn folder_name(folder: &Path) -> String {
    folder
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default()
}

fn is_repository_folder(path: &Path) -> bool {
    path.join(".git").exists()
}

fn open_worktree(path: &Path) -> Result<(PathBuf, gix::Repository), ApiError> {
    if !path.exists() {
        return Err(ApiError::FolderNotFound {
            path: path.to_string_lossy().into_owned(),
        });
    }
    let worktree_path = platform::canonical(path).map_err(ApiError::unexpected)?;
    // Every Worktree root, main or linked, holds a `.git` entry (a folder or a file). Bare
    // repositories have none and have no Worktree to show as a Tab.
    if !is_repository_folder(&worktree_path) {
        return Err(ApiError::NotARepository {
            path: worktree_path.to_string_lossy().into_owned(),
        });
    }
    let repo = gix::open(&worktree_path).map_err(ApiError::unexpected)?;
    Ok((worktree_path, repo))
}
