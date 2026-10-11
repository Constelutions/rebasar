import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import type {
  CoreApi,
  CoreEvent,
  DiffRequest,
  FileDiff,
  HistoryCount,
  HistoryPage,
  GitHubAuthStatus,
  GitHubRepository,
  PullRequest,
  Tab,
  WorktreeStatus,
} from "./api";

export const tauriCoreApi: CoreApi = {
  openFolder: (path) => invoke<Tab>("open_folder", { path }),
  worktreeStatus: (path) => invoke<WorktreeStatus>("worktree_status", { path }),
  fileDiff: (path, request: DiffRequest) => invoke<FileDiff>("file_diff", { path, request }),
  watchWorktree: (path) => invoke<void>("watch_worktree", { path }),
  historyPage: (worktreePath, offset, limit, filter) =>
    invoke<HistoryPage>("history_page", { worktreePath, offset, limit, filter }),
  historyCount: (worktreePath, filter) =>
    invoke<HistoryCount>("history_count", { worktreePath, filter }),
  activateTab: (path) => invoke<void>("activate_tab", { path }),
  refreshTab: (path) => invoke<Tab>("refresh_tab", { path }),
  githubRemote: (path) => invoke<GitHubRepository | null>("github_remote", { path }),
  githubAuthStatus: () => invoke<GitHubAuthStatus>("github_auth_status"),
  signInToGitHub: (token) => invoke<GitHubAuthStatus>("sign_in_to_github", { token }),
  signOutOfGitHub: () => invoke<GitHubAuthStatus>("sign_out_of_github"),
  pullRequests: (path) => invoke<PullRequest[]>("pull_requests", { path }),
  onEvent: (handler) => listen<CoreEvent>("core-event", ({ payload }) => handler(payload)),
};
