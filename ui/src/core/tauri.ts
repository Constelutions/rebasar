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
  GitIdentity,
  PullRequest,
  Settings,
  GitSetup,
  MutationOutcome,
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
  checkGit: () => invoke<GitSetup>("check_git"),
  stageFiles: (path, paths) => invoke<MutationOutcome>("stage_files", { path, paths }),
  unstageFiles: (path, paths) => invoke<MutationOutcome>("unstage_files", { path, paths }),
  commit: (path, message) => invoke<MutationOutcome>("commit", { path, message }),
  cancelMutation: (mutationId) => invoke<void>("cancel_mutation", { mutationId }),
  settings: () => invoke<Settings>("settings"),
  updateSettings: (settings) => invoke<Settings>("update_settings", { settings }),
  gitIdentity: () => invoke<GitIdentity>("git_identity"),
  setGitIdentity: (identity) => invoke<GitIdentity>("set_git_identity", { identity }),
  onEvent: (handler) => listen<CoreEvent>("core-event", ({ payload }) => handler(payload)),
};
