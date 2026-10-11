#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::path::PathBuf;
use std::sync::Arc;

use rebasar_core::{
    ApiError, CommitDetail, CommitDiffRequest, CommitHit, Core, DiffRequest, FileDiff,
    GitHubAuthStatus, GitHubRepository, GitIdentity, GitSetup, Group, HistoryCount, HistoryFilter,
    HistoryPage, MutationId, MutationOutcome, PullRequest, RefLabel, RepositoryList, Session,
    Settings, Tab, WindowBounds, WorktreeStatus,
};
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
            .with_registry_file(app.path().app_config_dir()?.join("registry.json"));
            if let (Some(window), Some(bounds)) =
                (app.get_webview_window("main"), core.window_bounds())
            {
                restore_window(&window, bounds);
            }
            let config_dir = app.path().app_config_dir()?;
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
            remove_repository
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Rebasar");
}
