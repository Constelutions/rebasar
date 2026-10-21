#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::path::PathBuf;
use std::sync::Arc;

use rebasar_core::{
    ApiError, Assessment, BranchInfo, ConflictFile, ConflictSide, CommitDetail, CommitDiffRequest, CommitHit, CommitOptions, Core,
    DiffRequest, FileChange, FileDiff, FoundRepository, GitHubAuthStatus, GitHubRepository, GitIdentity, GitSetup, Group,
    HistoryCount, HistoryFilter, HistoryPage, LineSelection, MutationId, MergeMode, MutationKind, ResetMode, StashInfo, StashPreview, RemoteInfo, TagInfo, WorktreeDetail, WorktreeStart, RebasePlan, MutationOutcome, OperationInProgress, PullStrategy,
    OutgoingCommit, PullRequest, PullRequestDetails, RefLabel, RepositoryList, Session, Settings, Tab, WindowBounds,
    SyncStatus, WorktreeDiffRequest, WorktreeStatus,
};
use rebasar_core::platform::Editor;
use tauri::{Emitter, Manager, PhysicalSize, State, WebviewWindow, WindowEvent};

#[tauri::command]
async fn open_folder(core: State<'_, Arc<Core>>, path: PathBuf) -> Result<Tab, ApiError> {
    let core = Arc::clone(&core);
    tauri::async_runtime::spawn_blocking(move || core.open_folder(&path))
        .await
        .map_err(ApiError::unexpected)?
}

#[tauri::command]
async fn worktree_status(
    core: State<'_, Arc<Core>>,
    path: PathBuf,
) -> Result<WorktreeStatus, ApiError> {
    let core = Arc::clone(&core);
    tauri::async_runtime::spawn_blocking(move || core.worktree_status(&path))
        .await
        .map_err(ApiError::unexpected)?
}

#[tauri::command]
async fn file_diff(
    core: State<'_, Arc<Core>>,
    path: PathBuf,
    request: DiffRequest,
) -> Result<FileDiff, ApiError> {
    let core = Arc::clone(&core);
    tauri::async_runtime::spawn_blocking(move || core.file_diff(&path, &request))
        .await
        .map_err(ApiError::unexpected)?
}

#[tauri::command]
async fn watch_worktree(core: State<'_, Arc<Core>>, path: PathBuf) -> Result<(), ApiError> {
    let core = Arc::clone(&core);
    tauri::async_runtime::spawn_blocking(move || core.watch_worktree(&path))
        .await
        .map_err(ApiError::unexpected)?
}

#[tauri::command]
async fn history_page(
    core: State<'_, Arc<Core>>,
    worktree_path: PathBuf,
    offset: usize,
    limit: usize,
    filter: HistoryFilter,
) -> Result<HistoryPage, ApiError> {
    let core = Arc::clone(&core);
    tauri::async_runtime::spawn_blocking(move || {
        core.history_page(&worktree_path, offset, limit, &filter)
    })
    .await
    .map_err(ApiError::unexpected)?
}

#[tauri::command]
async fn history_count(
    core: State<'_, Arc<Core>>,
    worktree_path: PathBuf,
    filter: HistoryFilter,
) -> Result<HistoryCount, ApiError> {
    let core = Arc::clone(&core);
    tauri::async_runtime::spawn_blocking(move || core.history_count(&worktree_path, &filter))
        .await
        .map_err(ApiError::unexpected)?
}

#[tauri::command]
async fn activate_tab(core: State<'_, Arc<Core>>, path: PathBuf) -> Result<(), ApiError> {
    let core = Arc::clone(&core);
    tauri::async_runtime::spawn_blocking(move || core.activate_tab(&path))
        .await
        .map_err(ApiError::unexpected)?
}

#[tauri::command]
async fn refresh_tab(core: State<'_, Arc<Core>>, path: PathBuf) -> Result<Tab, ApiError> {
    let core = Arc::clone(&core);
    tauri::async_runtime::spawn_blocking(move || core.refresh_tab(&path))
        .await
        .map_err(ApiError::unexpected)?
}

#[tauri::command]
async fn github_remote(
    core: State<'_, Arc<Core>>,
    path: PathBuf,
) -> Result<Option<GitHubRepository>, ApiError> {
    let core = Arc::clone(&core);
    tauri::async_runtime::spawn_blocking(move || core.github_remote(&path))
        .await
        .map_err(ApiError::unexpected)?
}

#[tauri::command]
async fn github_auth_status(core: State<'_, Arc<Core>>) -> Result<GitHubAuthStatus, ApiError> {
    let core = Arc::clone(&core);
    tauri::async_runtime::spawn_blocking(move || core.github_auth_status())
        .await
        .map_err(ApiError::unexpected)?
}

#[tauri::command]
async fn sign_in_to_github(
    core: State<'_, Arc<Core>>,
    token: String,
) -> Result<GitHubAuthStatus, ApiError> {
    let core = Arc::clone(&core);
    tauri::async_runtime::spawn_blocking(move || core.sign_in_to_github(&token))
        .await
        .map_err(ApiError::unexpected)?
}

#[tauri::command]
async fn sign_out_of_github(core: State<'_, Arc<Core>>) -> Result<GitHubAuthStatus, ApiError> {
    let core = Arc::clone(&core);
    tauri::async_runtime::spawn_blocking(move || core.sign_out_of_github())
        .await
        .map_err(ApiError::unexpected)?
}

#[tauri::command]
async fn pull_requests(
    core: State<'_, Arc<Core>>,
    path: PathBuf,
) -> Result<Vec<PullRequest>, ApiError> {
    let core = Arc::clone(&core);
    tauri::async_runtime::spawn_blocking(move || core.pull_requests(&path))
        .await
        .map_err(ApiError::unexpected)?
}

#[tauri::command]
async fn check_git(core: State<'_, Arc<Core>>) -> Result<GitSetup, ApiError> {
    let core = Arc::clone(&core);
    tauri::async_runtime::spawn_blocking(move || core.check_git())
        .await
        .map_err(ApiError::unexpected)
}

#[tauri::command]
async fn stage_files(
    core: State<'_, Arc<Core>>,
    path: PathBuf,
    paths: Vec<String>,
) -> Result<MutationOutcome, ApiError> {
    let core = Arc::clone(&core);
    tauri::async_runtime::spawn_blocking(move || core.stage(&path, &paths))
        .await
        .map_err(ApiError::unexpected)?
}

#[tauri::command]
async fn unstage_files(
    core: State<'_, Arc<Core>>,
    path: PathBuf,
    paths: Vec<String>,
) -> Result<MutationOutcome, ApiError> {
    let core = Arc::clone(&core);
    tauri::async_runtime::spawn_blocking(move || core.unstage(&path, &paths))
        .await
        .map_err(ApiError::unexpected)?
}

#[tauri::command]
async fn stage_lines(
    core: State<'_, Arc<Core>>,
    path: PathBuf,
    selection: LineSelection,
) -> Result<MutationOutcome, ApiError> {
    let core = Arc::clone(&core);
    tauri::async_runtime::spawn_blocking(move || core.stage_lines(&path, &selection))
        .await
        .map_err(ApiError::unexpected)?
}

#[tauri::command]
async fn unstage_lines(
    core: State<'_, Arc<Core>>,
    path: PathBuf,
    selection: LineSelection,
) -> Result<MutationOutcome, ApiError> {
    let core = Arc::clone(&core);
    tauri::async_runtime::spawn_blocking(move || core.unstage_lines(&path, &selection))
        .await
        .map_err(ApiError::unexpected)?
}

#[tauri::command]
async fn commit(
    core: State<'_, Arc<Core>>,
    path: PathBuf,
    message: String,
    options: CommitOptions,
) -> Result<MutationOutcome, ApiError> {
    let core = Arc::clone(&core);
    tauri::async_runtime::spawn_blocking(move || core.commit(&path, &message, options))
        .await
        .map_err(ApiError::unexpected)?
}

#[tauri::command]
async fn outgoing_commits(
    core: State<'_, Arc<Core>>,
    path: PathBuf,
) -> Result<Vec<OutgoingCommit>, ApiError> {
    let core = Arc::clone(&core);
    tauri::async_runtime::spawn_blocking(move || core.outgoing_commits(&path))
        .await
        .map_err(ApiError::unexpected)?
}

#[tauri::command]
fn cancel_mutation(core: State<'_, Arc<Core>>, mutation_id: MutationId) {
    core.cancel_mutation(mutation_id);
}

#[tauri::command]
async fn settings(core: State<'_, Arc<Core>>) -> Result<Settings, ApiError> {
    let core = Arc::clone(&core);
    tauri::async_runtime::spawn_blocking(move || core.settings())
        .await
        .map_err(ApiError::unexpected)?
}

#[tauri::command]
async fn update_settings(
    core: State<'_, Arc<Core>>,
    settings: Settings,
) -> Result<Settings, ApiError> {
    let core = Arc::clone(&core);
    tauri::async_runtime::spawn_blocking(move || core.update_settings(&settings))
        .await
        .map_err(ApiError::unexpected)?
}

#[tauri::command]
async fn git_identity(core: State<'_, Arc<Core>>) -> Result<GitIdentity, ApiError> {
    let core = Arc::clone(&core);
    tauri::async_runtime::spawn_blocking(move || core.git_identity())
        .await
        .map_err(ApiError::unexpected)?
}

#[tauri::command]
async fn set_git_identity(
    core: State<'_, Arc<Core>>,
    identity: GitIdentity,
) -> Result<GitIdentity, ApiError> {
    let core = Arc::clone(&core);
    tauri::async_runtime::spawn_blocking(move || core.set_git_identity(&identity))
        .await
        .map_err(ApiError::unexpected)?
}

#[tauri::command]
async fn repository_git_identity(
    core: State<'_, Arc<Core>>,
    worktree_path: PathBuf,
) -> Result<GitIdentity, ApiError> {
    let core = Arc::clone(&core);
    tauri::async_runtime::spawn_blocking(move || core.repository_git_identity(&worktree_path))
        .await
        .map_err(ApiError::unexpected)?
}

#[tauri::command]
async fn set_repository_git_identity(
    core: State<'_, Arc<Core>>,
    worktree_path: PathBuf,
    identity: GitIdentity,
) -> Result<GitIdentity, ApiError> {
    let core = Arc::clone(&core);
    tauri::async_runtime::spawn_blocking(move || {
        core.set_repository_git_identity(&worktree_path, &identity)
    })
    .await
    .map_err(ApiError::unexpected)?
}

#[tauri::command]
async fn commit_detail(
    core: State<'_, Arc<Core>>,
    worktree_path: PathBuf,
    commit: String,
    parent: usize,
) -> Result<CommitDetail, ApiError> {
    let core = Arc::clone(&core);
    tauri::async_runtime::spawn_blocking(move || {
        core.commit_detail(&worktree_path, &commit, parent)
    })
    .await
    .map_err(ApiError::unexpected)?
}

#[tauri::command]
async fn commit_file_diff(
    core: State<'_, Arc<Core>>,
    worktree_path: PathBuf,
    request: CommitDiffRequest,
) -> Result<FileDiff, ApiError> {
    let core = Arc::clone(&core);
    tauri::async_runtime::spawn_blocking(move || core.commit_file_diff(&worktree_path, &request))
        .await
        .map_err(ApiError::unexpected)?
}

#[tauri::command]
async fn find_commits(
    core: State<'_, Arc<Core>>,
    worktree_path: PathBuf,
    query: String,
    limit: usize,
) -> Result<Vec<CommitHit>, ApiError> {
    let core = Arc::clone(&core);
    tauri::async_runtime::spawn_blocking(move || core.find_commits(&worktree_path, &query, limit))
        .await
        .map_err(ApiError::unexpected)?
}

#[tauri::command]
async fn list_branches(
    core: State<'_, Arc<Core>>,
    worktree_path: PathBuf,
) -> Result<Vec<RefLabel>, ApiError> {
    let core = Arc::clone(&core);
    tauri::async_runtime::spawn_blocking(move || core.list_branches(&worktree_path))
        .await
        .map_err(ApiError::unexpected)?
}

#[tauri::command]
async fn restore_session(core: State<'_, Arc<Core>>) -> Result<Session, ApiError> {
    let core = Arc::clone(&core);
    tauri::async_runtime::spawn_blocking(move || core.restore_session())
        .await
        .map_err(ApiError::unexpected)
}

#[tauri::command]
async fn close_tab(core: State<'_, Arc<Core>>, path: PathBuf) -> Result<(), ApiError> {
    let core = Arc::clone(&core);
    tauri::async_runtime::spawn_blocking(move || core.close_tab(&path))
        .await
        .map_err(ApiError::unexpected)
}

#[tauri::command]
async fn watch_background_tab(core: State<'_, Arc<Core>>, path: PathBuf) -> Result<(), ApiError> {
    let core = Arc::clone(&core);
    tauri::async_runtime::spawn_blocking(move || core.watch_background_tab(&path))
        .await
        .map_err(ApiError::unexpected)?
}

#[tauri::command]
async fn save_view(core: State<'_, Arc<Core>>, view: String) -> Result<(), ApiError> {
    let core = Arc::clone(&core);
    tauri::async_runtime::spawn_blocking(move || core.save_view(&view))
        .await
        .map_err(ApiError::unexpected)
}

#[tauri::command]
async fn list_repositories(core: State<'_, Arc<Core>>) -> Result<RepositoryList, ApiError> {
    let core = Arc::clone(&core);
    tauri::async_runtime::spawn_blocking(move || core.repositories())
        .await
        .map_err(ApiError::unexpected)
}

#[tauri::command]
async fn create_group(core: State<'_, Arc<Core>>, name: String) -> Result<Group, ApiError> {
    let core = Arc::clone(&core);
    tauri::async_runtime::spawn_blocking(move || core.create_group(&name))
        .await
        .map_err(ApiError::unexpected)?
}

#[tauri::command]
async fn rename_group(
    core: State<'_, Arc<Core>>,
    id: String,
    name: String,
) -> Result<(), ApiError> {
    let core = Arc::clone(&core);
    tauri::async_runtime::spawn_blocking(move || core.rename_group(&id, &name))
        .await
        .map_err(ApiError::unexpected)?
}

#[tauri::command]
async fn move_group(core: State<'_, Arc<Core>>, id: String, index: usize) -> Result<(), ApiError> {
    let core = Arc::clone(&core);
    tauri::async_runtime::spawn_blocking(move || core.move_group(&id, index))
        .await
        .map_err(ApiError::unexpected)?
}

#[tauri::command]
async fn move_repository(
    core: State<'_, Arc<Core>>,
    path: PathBuf,
    group_id: Option<String>,
) -> Result<(), ApiError> {
    let core = Arc::clone(&core);
    tauri::async_runtime::spawn_blocking(move || core.move_repository(&path, group_id.as_deref()))
        .await
        .map_err(ApiError::unexpected)?
}

#[tauri::command]
async fn locate_repository(
    core: State<'_, Arc<Core>>,
    path: PathBuf,
    new_path: PathBuf,
) -> Result<(), ApiError> {
    let core = Arc::clone(&core);
    tauri::async_runtime::spawn_blocking(move || core.locate_repository(&path, &new_path))
        .await
        .map_err(ApiError::unexpected)?
}

#[tauri::command]
async fn remove_repository(core: State<'_, Arc<Core>>, path: PathBuf) -> Result<(), ApiError> {
    let core = Arc::clone(&core);
    tauri::async_runtime::spawn_blocking(move || core.remove_repository(&path))
        .await
        .map_err(ApiError::unexpected)?
}

#[tauri::command]
async fn clone_repository(
    core: State<'_, Arc<Core>>,
    url: String,
    parent: PathBuf,
    group_id: Option<String>,
) -> Result<Option<Tab>, ApiError> {
    let core = Arc::clone(&core);
    tauri::async_runtime::spawn_blocking(move || {
        core.clone_repository(&url, &parent, group_id.as_deref())
    })
    .await
    .map_err(ApiError::unexpected)?
}

#[tauri::command]
async fn init_repository(
    core: State<'_, Arc<Core>>,
    folder: PathBuf,
    group_id: Option<String>,
) -> Result<Option<Tab>, ApiError> {
    let core = Arc::clone(&core);
    tauri::async_runtime::spawn_blocking(move || core.init_repository(&folder, group_id.as_deref()))
        .await
        .map_err(ApiError::unexpected)?
}

#[tauri::command]
async fn scan_folder(
    core: State<'_, Arc<Core>>,
    parent: PathBuf,
) -> Result<Vec<FoundRepository>, ApiError> {
    let core = Arc::clone(&core);
    tauri::async_runtime::spawn_blocking(move || core.scan_folder(&parent))
        .await
        .map_err(ApiError::unexpected)?
}

#[tauri::command]
async fn import_repositories(
    core: State<'_, Arc<Core>>,
    paths: Vec<PathBuf>,
    group_id: Option<String>,
) -> Result<(), ApiError> {
    let core = Arc::clone(&core);
    tauri::async_runtime::spawn_blocking(move || {
        core.import_repositories(&paths, group_id.as_deref())
    })
    .await
    .map_err(ApiError::unexpected)?
}

#[tauri::command]
async fn checkout_commit(
    core: State<'_, Arc<Core>>,
    path: PathBuf,
    commit: String,
) -> Result<MutationOutcome, ApiError> {
    let core = Arc::clone(&core);
    tauri::async_runtime::spawn_blocking(move || core.checkout_commit(&path, &commit))
        .await
        .map_err(ApiError::unexpected)?
}

#[tauri::command]
async fn create_branch(
    core: State<'_, Arc<Core>>,
    path: PathBuf,
    name: String,
    commit: String,
) -> Result<MutationOutcome, ApiError> {
    let core = Arc::clone(&core);
    tauri::async_runtime::spawn_blocking(move || core.create_branch(&path, &name, &commit))
        .await
        .map_err(ApiError::unexpected)?
}

#[tauri::command]
async fn create_tag(
    core: State<'_, Arc<Core>>,
    path: PathBuf,
    name: String,
    commit: String,
) -> Result<MutationOutcome, ApiError> {
    let core = Arc::clone(&core);
    tauri::async_runtime::spawn_blocking(move || core.create_tag(&path, &name, &commit))
        .await
        .map_err(ApiError::unexpected)?
}

#[tauri::command]
async fn reword_latest_commit(
    core: State<'_, Arc<Core>>,
    path: PathBuf,
    commit: String,
    message: String,
) -> Result<MutationOutcome, ApiError> {
    let core = Arc::clone(&core);
    tauri::async_runtime::spawn_blocking(move || {
        core.reword_latest_commit(&path, &commit, &message)
    })
    .await
    .map_err(ApiError::unexpected)?
}

#[tauri::command]
async fn compare_with_worktree(
    core: State<'_, Arc<Core>>,
    worktree_path: PathBuf,
    commit: String,
) -> Result<Vec<FileChange>, ApiError> {
    let core = Arc::clone(&core);
    tauri::async_runtime::spawn_blocking(move || core.compare_with_worktree(&worktree_path, &commit))
        .await
        .map_err(ApiError::unexpected)?
}

#[tauri::command]
async fn compare_file_diff(
    core: State<'_, Arc<Core>>,
    worktree_path: PathBuf,
    request: WorktreeDiffRequest,
) -> Result<FileDiff, ApiError> {
    let core = Arc::clone(&core);
    tauri::async_runtime::spawn_blocking(move || core.compare_file_diff(&worktree_path, &request))
        .await
        .map_err(ApiError::unexpected)?
}

#[tauri::command]
async fn operation_in_progress(
    core: State<'_, Arc<Core>>,
    path: PathBuf,
) -> Result<Option<OperationInProgress>, ApiError> {
    let core = Arc::clone(&core);
    tauri::async_runtime::spawn_blocking(move || core.operation_in_progress(&path))
        .await
        .map_err(ApiError::unexpected)?
}

#[tauri::command]
async fn continue_operation(
    core: State<'_, Arc<Core>>,
    path: PathBuf,
) -> Result<MutationOutcome, ApiError> {
    let core = Arc::clone(&core);
    tauri::async_runtime::spawn_blocking(move || core.continue_operation(&path))
        .await
        .map_err(ApiError::unexpected)?
}

#[tauri::command]
async fn skip_operation(
    core: State<'_, Arc<Core>>,
    path: PathBuf,
) -> Result<MutationOutcome, ApiError> {
    let core = Arc::clone(&core);
    tauri::async_runtime::spawn_blocking(move || core.skip_operation(&path))
        .await
        .map_err(ApiError::unexpected)?
}

#[tauri::command]
async fn abort_operation(
    core: State<'_, Arc<Core>>,
    path: PathBuf,
) -> Result<MutationOutcome, ApiError> {
    let core = Arc::clone(&core);
    tauri::async_runtime::spawn_blocking(move || core.abort_operation(&path))
        .await
        .map_err(ApiError::unexpected)?
}

#[tauri::command]
async fn sync_status(
    core: State<'_, Arc<Core>>,
    path: PathBuf,
) -> Result<SyncStatus, ApiError> {
    let core = Arc::clone(&core);
    tauri::async_runtime::spawn_blocking(move || core.sync_status(&path))
        .await
        .map_err(ApiError::unexpected)?
}

#[tauri::command]
async fn fetch_remotes(
    core: State<'_, Arc<Core>>,
    path: PathBuf,
) -> Result<MutationOutcome, ApiError> {
    let core = Arc::clone(&core);
    tauri::async_runtime::spawn_blocking(move || core.fetch(&path))
        .await
        .map_err(ApiError::unexpected)?
}

#[tauri::command]
async fn pull_needs_strategy(
    core: State<'_, Arc<Core>>,
    path: PathBuf,
) -> Result<bool, ApiError> {
    let core = Arc::clone(&core);
    tauri::async_runtime::spawn_blocking(move || core.pull_needs_strategy(&path))
        .await
        .map_err(ApiError::unexpected)?
}

#[tauri::command]
async fn pull(
    core: State<'_, Arc<Core>>,
    path: PathBuf,
    strategy: Option<PullStrategy>,
    remember: bool,
) -> Result<MutationOutcome, ApiError> {
    let core = Arc::clone(&core);
    tauri::async_runtime::spawn_blocking(move || core.pull(&path, strategy, remember))
        .await
        .map_err(ApiError::unexpected)?
}

#[tauri::command]
async fn push(
    core: State<'_, Arc<Core>>,
    path: PathBuf,
    force: bool,
) -> Result<MutationOutcome, ApiError> {
    let core = Arc::clone(&core);
    tauri::async_runtime::spawn_blocking(move || core.push(&path, force))
        .await
        .map_err(ApiError::unexpected)?
}

#[tauri::command]
async fn list_branch_details(
    core: State<'_, Arc<Core>>,
    path: PathBuf,
) -> Result<Vec<BranchInfo>, ApiError> {
    let core = Arc::clone(&core);
    tauri::async_runtime::spawn_blocking(move || core.list_branch_details(&path))
        .await
        .map_err(ApiError::unexpected)?
}

#[tauri::command]
async fn create_branch_here(
    core: State<'_, Arc<Core>>,
    path: PathBuf,
    name: String,
    switch: bool,
) -> Result<MutationOutcome, ApiError> {
    let core = Arc::clone(&core);
    tauri::async_runtime::spawn_blocking(move || core.create_branch_here(&path, &name, switch))
        .await
        .map_err(ApiError::unexpected)?
}

#[tauri::command]
async fn checkout_branch(
    core: State<'_, Arc<Core>>,
    path: PathBuf,
    name: String,
    remote: bool,
) -> Result<MutationOutcome, ApiError> {
    let core = Arc::clone(&core);
    tauri::async_runtime::spawn_blocking(move || core.checkout_branch(&path, &name, remote))
        .await
        .map_err(ApiError::unexpected)?
}

#[tauri::command]
async fn rename_branch(
    core: State<'_, Arc<Core>>,
    path: PathBuf,
    name: String,
    new_name: String,
) -> Result<MutationOutcome, ApiError> {
    let core = Arc::clone(&core);
    tauri::async_runtime::spawn_blocking(move || core.rename_branch(&path, &name, &new_name))
        .await
        .map_err(ApiError::unexpected)?
}

#[tauri::command]
async fn delete_branch(
    core: State<'_, Arc<Core>>,
    path: PathBuf,
    name: String,
) -> Result<MutationOutcome, ApiError> {
    let core = Arc::clone(&core);
    tauri::async_runtime::spawn_blocking(move || core.delete_branch(&path, &name))
        .await
        .map_err(ApiError::unexpected)?
}

#[tauri::command]
async fn delete_remote_branch(
    core: State<'_, Arc<Core>>,
    path: PathBuf,
    remote: String,
    name: String,
) -> Result<MutationOutcome, ApiError> {
    let core = Arc::clone(&core);
    tauri::async_runtime::spawn_blocking(move || core.delete_remote_branch(&path, &remote, &name))
        .await
        .map_err(ApiError::unexpected)?
}

#[tauri::command]
async fn set_branch_upstream(
    core: State<'_, Arc<Core>>,
    path: PathBuf,
    name: String,
    upstream: Option<String>,
) -> Result<MutationOutcome, ApiError> {
    let core = Arc::clone(&core);
    tauri::async_runtime::spawn_blocking(move || core.set_branch_upstream(&path, &name, upstream.as_deref()))
        .await
        .map_err(ApiError::unexpected)?
}

#[tauri::command]
async fn merge_branch(
    core: State<'_, Arc<Core>>,
    path: PathBuf,
    branch: String,
    mode: MergeMode,
) -> Result<MutationOutcome, ApiError> {
    let core = Arc::clone(&core);
    tauri::async_runtime::spawn_blocking(move || core.merge_branch(&path, &branch, mode))
        .await
        .map_err(ApiError::unexpected)?
}

#[tauri::command]
async fn rebase_onto(
    core: State<'_, Arc<Core>>,
    path: PathBuf,
    onto: String,
) -> Result<MutationOutcome, ApiError> {
    let core = Arc::clone(&core);
    tauri::async_runtime::spawn_blocking(move || core.rebase_onto(&path, &onto))
        .await
        .map_err(ApiError::unexpected)?
}

#[tauri::command]
async fn conflict_file(
    core: State<'_, Arc<Core>>,
    path: PathBuf,
    file: String,
) -> Result<ConflictFile, ApiError> {
    let core = Arc::clone(&core);
    tauri::async_runtime::spawn_blocking(move || core.conflict_file(&path, &file))
        .await
        .map_err(ApiError::unexpected)?
}

#[tauri::command]
async fn resolve_conflict_file(
    core: State<'_, Arc<Core>>,
    path: PathBuf,
    file: String,
    contents: String,
) -> Result<MutationOutcome, ApiError> {
    let core = Arc::clone(&core);
    tauri::async_runtime::spawn_blocking(move || core.resolve_conflict_file(&path, &file, &contents))
        .await
        .map_err(ApiError::unexpected)?
}

#[tauri::command]
async fn resolve_conflict_with_side(
    core: State<'_, Arc<Core>>,
    path: PathBuf,
    file: String,
    side: ConflictSide,
) -> Result<MutationOutcome, ApiError> {
    let core = Arc::clone(&core);
    tauri::async_runtime::spawn_blocking(move || core.resolve_conflict_with_side(&path, &file, side))
        .await
        .map_err(ApiError::unexpected)?
}

#[tauri::command]
async fn open_merge_tool(
    core: State<'_, Arc<Core>>,
    path: PathBuf,
    file: String,
) -> Result<MutationOutcome, ApiError> {
    let core = Arc::clone(&core);
    tauri::async_runtime::spawn_blocking(move || core.open_merge_tool(&path, &file))
        .await
        .map_err(ApiError::unexpected)?
}

#[tauri::command]
async fn rebase_plan(
    core: State<'_, Arc<Core>>,
    path: PathBuf,
    from: Option<String>,
) -> Result<RebasePlan, ApiError> {
    let core = Arc::clone(&core);
    tauri::async_runtime::spawn_blocking(move || core.rebase_plan(&path, from.as_deref()))
        .await
        .map_err(ApiError::unexpected)?
}

#[tauri::command]
async fn apply_rebase_plan(
    core: State<'_, Arc<Core>>,
    path: PathBuf,
    plan: RebasePlan,
) -> Result<MutationOutcome, ApiError> {
    let core = Arc::clone(&core);
    tauri::async_runtime::spawn_blocking(move || core.apply_rebase_plan(&path, &plan))
        .await
        .map_err(ApiError::unexpected)?
}

#[tauri::command]
async fn cherry_pick_commit(
    core: State<'_, Arc<Core>>,
    path: PathBuf,
    commit: String,
) -> Result<MutationOutcome, ApiError> {
    let core = Arc::clone(&core);
    tauri::async_runtime::spawn_blocking(move || core.cherry_pick_commit(&path, &commit))
        .await
        .map_err(ApiError::unexpected)?
}

#[tauri::command]
async fn revert_commit(
    core: State<'_, Arc<Core>>,
    path: PathBuf,
    commit: String,
) -> Result<MutationOutcome, ApiError> {
    let core = Arc::clone(&core);
    tauri::async_runtime::spawn_blocking(move || core.revert_commit(&path, &commit))
        .await
        .map_err(ApiError::unexpected)?
}

#[tauri::command]
async fn reset_to_commit(
    core: State<'_, Arc<Core>>,
    path: PathBuf,
    commit: String,
    mode: ResetMode,
) -> Result<MutationOutcome, ApiError> {
    let core = Arc::clone(&core);
    tauri::async_runtime::spawn_blocking(move || core.reset_to_commit(&path, &commit, mode))
        .await
        .map_err(ApiError::unexpected)?
}

#[tauri::command]
async fn list_stashes(
    core: State<'_, Arc<Core>>,
    path: PathBuf,
) -> Result<Vec<StashInfo>, ApiError> {
    let core = Arc::clone(&core);
    tauri::async_runtime::spawn_blocking(move || core.list_stashes(&path))
        .await
        .map_err(ApiError::unexpected)?
}

#[tauri::command]
async fn stash_preview(
    core: State<'_, Arc<Core>>,
    path: PathBuf,
    stash: String,
) -> Result<StashPreview, ApiError> {
    let core = Arc::clone(&core);
    tauri::async_runtime::spawn_blocking(move || core.stash_preview(&path, &stash))
        .await
        .map_err(ApiError::unexpected)?
}

#[tauri::command]
async fn stash_changes(
    core: State<'_, Arc<Core>>,
    path: PathBuf,
    message: Option<String>,
    include_untracked: bool,
) -> Result<MutationOutcome, ApiError> {
    let core = Arc::clone(&core);
    tauri::async_runtime::spawn_blocking(move || core.stash_changes(&path, message.as_deref(), include_untracked))
        .await
        .map_err(ApiError::unexpected)?
}

#[tauri::command]
async fn apply_stash(
    core: State<'_, Arc<Core>>,
    path: PathBuf,
    stash: String,
) -> Result<MutationOutcome, ApiError> {
    let core = Arc::clone(&core);
    tauri::async_runtime::spawn_blocking(move || core.apply_stash(&path, &stash))
        .await
        .map_err(ApiError::unexpected)?
}

#[tauri::command]
async fn pop_stash(
    core: State<'_, Arc<Core>>,
    path: PathBuf,
    stash: String,
) -> Result<MutationOutcome, ApiError> {
    let core = Arc::clone(&core);
    tauri::async_runtime::spawn_blocking(move || core.pop_stash(&path, &stash))
        .await
        .map_err(ApiError::unexpected)?
}

#[tauri::command]
async fn drop_stash(
    core: State<'_, Arc<Core>>,
    path: PathBuf,
    stash: String,
) -> Result<MutationOutcome, ApiError> {
    let core = Arc::clone(&core);
    tauri::async_runtime::spawn_blocking(move || core.drop_stash(&path, &stash))
        .await
        .map_err(ApiError::unexpected)?
}

#[tauri::command]
async fn list_worktree_details(
    core: State<'_, Arc<Core>>,
    path: PathBuf,
) -> Result<Vec<WorktreeDetail>, ApiError> {
    let core = Arc::clone(&core);
    tauri::async_runtime::spawn_blocking(move || core.list_worktree_details(&path))
        .await
        .map_err(ApiError::unexpected)?
}

#[tauri::command]
async fn create_worktree(
    core: State<'_, Arc<Core>>,
    path: PathBuf,
    target: PathBuf,
    from: WorktreeStart,
    new_branch: Option<String>,
) -> Result<MutationOutcome, ApiError> {
    let core = Arc::clone(&core);
    tauri::async_runtime::spawn_blocking(move || core.create_worktree(&path, &target, &from, new_branch.as_deref()))
        .await
        .map_err(ApiError::unexpected)?
}

#[tauri::command]
async fn remove_worktree(
    core: State<'_, Arc<Core>>,
    path: PathBuf,
    target: PathBuf,
    force: bool,
) -> Result<MutationOutcome, ApiError> {
    let core = Arc::clone(&core);
    tauri::async_runtime::spawn_blocking(move || core.remove_worktree(&path, &target, force))
        .await
        .map_err(ApiError::unexpected)?
}

#[tauri::command]
async fn prune_worktrees(
    core: State<'_, Arc<Core>>,
    path: PathBuf,
) -> Result<MutationOutcome, ApiError> {
    let core = Arc::clone(&core);
    tauri::async_runtime::spawn_blocking(move || core.prune_worktrees(&path))
        .await
        .map_err(ApiError::unexpected)?
}

#[tauri::command]
async fn list_tags(
    core: State<'_, Arc<Core>>,
    path: PathBuf,
) -> Result<Vec<TagInfo>, ApiError> {
    let core = Arc::clone(&core);
    tauri::async_runtime::spawn_blocking(move || core.list_tags(&path))
        .await
        .map_err(ApiError::unexpected)?
}

#[tauri::command]
async fn create_tag_here(
    core: State<'_, Arc<Core>>,
    path: PathBuf,
    name: String,
    message: Option<String>,
) -> Result<MutationOutcome, ApiError> {
    let core = Arc::clone(&core);
    tauri::async_runtime::spawn_blocking(move || core.create_tag_here(&path, &name, message.as_deref()))
        .await
        .map_err(ApiError::unexpected)?
}

#[tauri::command]
async fn delete_tag(
    core: State<'_, Arc<Core>>,
    path: PathBuf,
    name: String,
) -> Result<MutationOutcome, ApiError> {
    let core = Arc::clone(&core);
    tauri::async_runtime::spawn_blocking(move || core.delete_tag(&path, &name))
        .await
        .map_err(ApiError::unexpected)?
}

#[tauri::command]
async fn push_tag(
    core: State<'_, Arc<Core>>,
    path: PathBuf,
    name: String,
    remote: String,
) -> Result<MutationOutcome, ApiError> {
    let core = Arc::clone(&core);
    tauri::async_runtime::spawn_blocking(move || core.push_tag(&path, &name, &remote))
        .await
        .map_err(ApiError::unexpected)?
}

#[tauri::command]
async fn delete_remote_tag(
    core: State<'_, Arc<Core>>,
    path: PathBuf,
    name: String,
    remote: String,
) -> Result<MutationOutcome, ApiError> {
    let core = Arc::clone(&core);
    tauri::async_runtime::spawn_blocking(move || core.delete_remote_tag(&path, &name, &remote))
        .await
        .map_err(ApiError::unexpected)?
}

#[tauri::command]
async fn list_remotes(
    core: State<'_, Arc<Core>>,
    path: PathBuf,
) -> Result<Vec<RemoteInfo>, ApiError> {
    let core = Arc::clone(&core);
    tauri::async_runtime::spawn_blocking(move || core.list_remotes(&path))
        .await
        .map_err(ApiError::unexpected)?
}

#[tauri::command]
async fn add_remote(
    core: State<'_, Arc<Core>>,
    path: PathBuf,
    name: String,
    url: String,
) -> Result<MutationOutcome, ApiError> {
    let core = Arc::clone(&core);
    tauri::async_runtime::spawn_blocking(move || core.add_remote(&path, &name, &url))
        .await
        .map_err(ApiError::unexpected)?
}

#[tauri::command]
async fn rename_remote(
    core: State<'_, Arc<Core>>,
    path: PathBuf,
    name: String,
    new_name: String,
) -> Result<MutationOutcome, ApiError> {
    let core = Arc::clone(&core);
    tauri::async_runtime::spawn_blocking(move || core.rename_remote(&path, &name, &new_name))
        .await
        .map_err(ApiError::unexpected)?
}

#[tauri::command]
async fn set_remote_url(
    core: State<'_, Arc<Core>>,
    path: PathBuf,
    name: String,
    url: String,
) -> Result<MutationOutcome, ApiError> {
    let core = Arc::clone(&core);
    tauri::async_runtime::spawn_blocking(move || core.set_remote_url(&path, &name, &url))
        .await
        .map_err(ApiError::unexpected)?
}

#[tauri::command]
async fn remove_remote(
    core: State<'_, Arc<Core>>,
    path: PathBuf,
    name: String,
) -> Result<MutationOutcome, ApiError> {
    let core = Arc::clone(&core);
    tauri::async_runtime::spawn_blocking(move || core.remove_remote(&path, &name))
        .await
        .map_err(ApiError::unexpected)?
}

#[tauri::command]
async fn current_pull_request(
    core: State<'_, Arc<Core>>,
    path: PathBuf,
) -> Result<Option<PullRequestDetails>, ApiError> {
    let core = Arc::clone(&core);
    tauri::async_runtime::spawn_blocking(move || core.current_pull_request(&path))
        .await
        .map_err(ApiError::unexpected)?
}

#[tauri::command]
async fn create_pull_request(
    core: State<'_, Arc<Core>>,
    path: PathBuf,
    title: String,
    body: String,
    draft: bool,
) -> Result<PullRequestDetails, ApiError> {
    let core = Arc::clone(&core);
    tauri::async_runtime::spawn_blocking(move || core.create_pull_request(&path, &title, &body, draft))
        .await
        .map_err(ApiError::unexpected)?
}

#[tauri::command]
async fn update_pull_request(
    core: State<'_, Arc<Core>>,
    path: PathBuf,
    number: u64,
    title: String,
    body: String,
) -> Result<PullRequestDetails, ApiError> {
    let core = Arc::clone(&core);
    tauri::async_runtime::spawn_blocking(move || core.update_pull_request(&path, number, &title, &body))
        .await
        .map_err(ApiError::unexpected)?
}

#[tauri::command]
async fn mark_pull_request_ready(
    core: State<'_, Arc<Core>>,
    path: PathBuf,
    number: u64,
) -> Result<PullRequestDetails, ApiError> {
    let core = Arc::clone(&core);
    tauri::async_runtime::spawn_blocking(move || core.mark_pull_request_ready(&path, number))
        .await
        .map_err(ApiError::unexpected)?
}

#[tauri::command]
async fn open_in_browser(
    core: State<'_, Arc<Core>>,
    url: String,
) -> Result<(), ApiError> {
    let core = Arc::clone(&core);
    tauri::async_runtime::spawn_blocking(move || core.open_in_browser(&url))
        .await
        .map_err(ApiError::unexpected)?
}

#[tauri::command]
async fn list_editors(core: State<'_, Arc<Core>>) -> Result<Vec<Editor>, ApiError> {
    let core = Arc::clone(&core);
    tauri::async_runtime::spawn_blocking(move || core.list_editors())
        .await
        .map_err(ApiError::unexpected)
}

#[tauri::command]
async fn open_in_editor(
    core: State<'_, Arc<Core>>,
    editor_id: String,
    path: PathBuf,
) -> Result<(), ApiError> {
    let core = Arc::clone(&core);
    tauri::async_runtime::spawn_blocking(move || core.open_in_editor(&editor_id, &path))
        .await
        .map_err(ApiError::unexpected)?
}

fn restore_window(window: &WebviewWindow, bounds: WindowBounds) {
    if let Err(error) = window.set_size(PhysicalSize::new(bounds.width, bounds.height)) {
        eprintln!("failed to restore the window size: {error}");
    }
    if bounds.maximized {
        if let Err(error) = window.maximize() {
            eprintln!("failed to maximize the window: {error}");
        }
    }
}

#[tauri::command]
async fn assess_mutation(
    core: State<'_, Arc<Core>>,
    path: PathBuf,
    kind: MutationKind,
) -> Result<Assessment, ApiError> {
    let core = Arc::clone(&core);
    tauri::async_runtime::spawn_blocking(move || core.assess_mutation(&path, &kind))
        .await
        .map_err(ApiError::unexpected)?
}

#[tauri::command]
async fn discard_changes(
    core: State<'_, Arc<Core>>,
    path: PathBuf,
    paths: Vec<String>,
) -> Result<MutationOutcome, ApiError> {
    let core = Arc::clone(&core);
    tauri::async_runtime::spawn_blocking(move || core.discard_changes(&path, &paths))
        .await
        .map_err(ApiError::unexpected)?
}

/// `REBASAR_CONFIG_DIR` keeps a test run, such as the smoke run, away from the user's own
/// registry and settings.
fn config_dir_of(app: &tauri::App) -> tauri::Result<PathBuf> {
    match std::env::var_os("REBASAR_CONFIG_DIR") {
        Some(folder) => Ok(PathBuf::from(folder)),
        None => app.path().app_config_dir(),
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let handle = app.handle().clone();
            let core = Core::new(move |event| {
                if let Err(error) = handle.emit("core-event", event) {
                    eprintln!("failed to emit core event: {error}");
                }
            })
            .with_registry_file(config_dir_of(app)?.join("registry.json"));
            if let (Some(window), Some(bounds)) =
                (app.get_webview_window("main"), core.window_bounds())
            {
                restore_window(&window, bounds);
            }
            let config_dir = config_dir_of(app)?;
            app.manage(Arc::new(core.with_config_dir(config_dir)));
            Ok(())
        })
        .on_window_event(|window, event| {
            if !matches!(event, WindowEvent::CloseRequested { .. }) {
                return;
            }
            if window.is_minimized().unwrap_or(false) {
                return;
            }
            if let (Ok(size), Ok(maximized)) = (window.inner_size(), window.is_maximized()) {
                window
                    .state::<Arc<Core>>()
                    .remember_window(size.width, size.height, maximized);
            }
        })
        .invoke_handler(tauri::generate_handler![
            open_folder,
            worktree_status,
            file_diff,
            watch_worktree,
            history_page,
            history_count,
            find_commits,
            list_branches,
            activate_tab,
            close_tab,
            refresh_tab,
            github_remote,
            github_auth_status,
            sign_in_to_github,
            sign_out_of_github,
            pull_requests,
            check_git,
            stage_files,
            unstage_files,
            stage_lines,
            unstage_lines,
            commit,
            assess_mutation,
            discard_changes,
            outgoing_commits,
            cancel_mutation,
            settings,
            update_settings,
            git_identity,
            set_git_identity,
            repository_git_identity,
            set_repository_git_identity,
            commit_detail,
            commit_file_diff,
            restore_session,
            watch_background_tab,
            save_view,
            list_repositories,
            create_group,
            rename_group,
            move_group,
            move_repository,
            locate_repository,
            remove_repository,
            clone_repository,
            init_repository,
            scan_folder,
            import_repositories,
            checkout_commit,
            create_branch,
            create_tag,
            reword_latest_commit,
            compare_with_worktree,
            compare_file_diff,
            operation_in_progress,
            continue_operation,
            skip_operation,
            abort_operation,
            sync_status,
            fetch_remotes,
            pull_needs_strategy,
            pull,
            push,
            list_branch_details,
            create_branch_here,
            checkout_branch,
            rename_branch,
            delete_branch,
            delete_remote_branch,
            set_branch_upstream,
            merge_branch,
            rebase_onto,
            conflict_file,
            resolve_conflict_file,
            resolve_conflict_with_side,
            open_merge_tool,
            rebase_plan,
            apply_rebase_plan,
            cherry_pick_commit,
            revert_commit,
            reset_to_commit,
            list_stashes,
            stash_preview,
            stash_changes,
            apply_stash,
            pop_stash,
            drop_stash,
            list_worktree_details,
            create_worktree,
            remove_worktree,
            prune_worktrees,
            list_tags,
            create_tag_here,
            delete_tag,
            push_tag,
            delete_remote_tag,
            list_remotes,
            add_remote,
            rename_remote,
            set_remote_url,
            remove_remote,
            current_pull_request,
            create_pull_request,
            update_pull_request,
            mark_pull_request_ready,
            open_in_browser,
            list_editors,
            open_in_editor
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Rebasar");
}
