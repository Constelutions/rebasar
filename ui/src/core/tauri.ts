import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import type { CoreApi, CoreEvent, Tab, WorktreeStatus } from "./api";

export const tauriCoreApi: CoreApi = {
  openFolder: (path) => invoke<Tab>("open_folder", { path }),
  worktreeStatus: (path) => invoke<WorktreeStatus>("worktree_status", { path }),
  watchWorktree: (path) => invoke<void>("watch_worktree", { path }),
  onEvent: (handler) => listen<CoreEvent>("core-event", ({ payload }) => handler(payload)),
};
