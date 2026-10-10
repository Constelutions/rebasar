#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::path::PathBuf;
use std::sync::Arc;

use rebasar_core::{
    ApiError, CommitDetail, CommitDiffRequest, Core, DiffRequest, FileDiff, GitHubAuthStatus,
    GitHubRepository, GitIdentity, GitSetup, HistoryCount, HistoryFilter, HistoryPage, MutationId,
    MutationOutcome, PullRequest, Settings, Tab, WorktreeStatus,
};
use tauri::{Emitter, Manager, State};

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
async fn commit(
    core: State<'_, Arc<Core>>,
    path: PathBuf,
    message: String,
) -> Result<MutationOutcome, ApiError> {
    let core = Arc::clone(&core);
    tauri::async_runtime::spawn_blocking(move || core.commit(&path, &message))
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

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let handle = app.handle().clone();
            let core = Core::new(move |event| {
                if let Err(error) = handle.emit("core-event", event) {
                    eprintln!("failed to emit core event: {error}");
                }
            });
            let config_dir = app.path().app_config_dir()?;
            app.manage(Arc::new(core.with_config_dir(config_dir)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            open_folder,
            worktree_status,
            file_diff,
            watch_worktree,
            history_page,
            history_count,
            activate_tab,
            refresh_tab,
            github_remote,
            github_auth_status,
            sign_in_to_github,
            sign_out_of_github,
            pull_requests,
            check_git,
            stage_files,
            unstage_files,
            commit,
            cancel_mutation,
            settings,
            update_settings,
            git_identity,
            set_git_identity,
            commit_detail,
            commit_file_diff
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Rebasar");
}
