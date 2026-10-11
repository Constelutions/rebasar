#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::path::PathBuf;
use std::sync::Arc;

use rebasar_core::{ApiError, Core, Tab, WorktreeStatus};
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
async fn watch_worktree(core: State<'_, Arc<Core>>, path: PathBuf) -> Result<(), ApiError> {
    let core = Arc::clone(&core);
    tauri::async_runtime::spawn_blocking(move || core.watch_worktree(&path))
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
            app.manage(Arc::new(core));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            open_folder,
            worktree_status,
            watch_worktree
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Rebasar");
}
