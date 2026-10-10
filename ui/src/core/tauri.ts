import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import type { CoreApi, CoreEvent, HistoryCount, HistoryPage, Tab, WorktreeStatus } from "./api";

export const tauriCoreApi: CoreApi = {
  openFolder: (path) => invoke<Tab>("open_folder", { path }),
  worktreeStatus: (path) => invoke<WorktreeStatus>("worktree_status", { path }),
  watchWorktree: (path) => invoke<void>("watch_worktree", { path }),
  historyPage: (worktreePath, offset, limit, filter) =>
    invoke<HistoryPage>("history_page", { worktreePath, offset, limit, filter }),
  historyCount: (worktreePath, filter) =>
    invoke<HistoryCount>("history_count", { worktreePath, filter }),
  onEvent: (handler) => listen<CoreEvent>("core-event", ({ payload }) => handler(payload)),
};
