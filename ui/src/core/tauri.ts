import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import type {
  Assessment,
  CommitDetail,
  BranchInfo,
  ConflictFile,
  ConflictSide,
  CommitDiffRequest,
  CommitHit,
  CoreApi,
  CoreEvent,
  DiffRequest,
  Editor,
  FileChange,
  FileDiff,
  HistoryCount,
  HistoryPage,
  GitHubAuthStatus,
  GitHubRepository,
  GitIdentity,
  LineSelection,
  PullRequest,
  RefLabel,
  RepositoryList,
  Session,
  Settings,
  GitSetup,
  FoundRepository,
  Group,
  MergeMode,
  MutationOutcome,
  OperationInProgress,
  RebasePlan,
  ResetMode,
  StashInfo,
  StashPreview,
  PullRequestDetails,
  RemoteInfo,
  TagInfo,
  WorktreeDetail,
  WorktreeStart,
  SyncStatus,
  OutgoingCommit,
  Tab,
  WorktreeDiffRequest,
  WorktreeStatus,
} from "./api";

export const tauriCoreApi: CoreApi = {
  openFolder: (path) => invoke<Tab>("open_folder", { path }),
  findCommits: (worktreePath, query, limit) =>
    invoke<CommitHit[]>("find_commits", { worktreePath, query, limit }),
  listBranches: (worktreePath) => invoke<RefLabel[]>("list_branches", { worktreePath }),
  worktreeStatus: (path) => invoke<WorktreeStatus>("worktree_status", { path }),
  fileDiff: (path, request: DiffRequest) => invoke<FileDiff>("file_diff", { path, request }),
  watchWorktree: (path) => invoke<void>("watch_worktree", { path }),
  historyPage: (worktreePath, offset, limit, filter) =>
    invoke<HistoryPage>("history_page", { worktreePath, offset, limit, filter }),
  historyCount: (worktreePath, filter) =>
    invoke<HistoryCount>("history_count", { worktreePath, filter }),
  commitDetail: (worktreePath, commit, parent) =>
    invoke<CommitDetail>("commit_detail", { worktreePath, commit, parent }),
  commitFileDiff: (worktreePath, request: CommitDiffRequest) =>
    invoke<FileDiff>("commit_file_diff", { worktreePath, request }),
  activateTab: (path) => invoke<void>("activate_tab", { path }),
  closeTab: (path) => invoke<void>("close_tab", { path }),
  refreshTab: (path) => invoke<Tab>("refresh_tab", { path }),
  githubRemote: (path) => invoke<GitHubRepository | null>("github_remote", { path }),
  githubAuthStatus: () => invoke<GitHubAuthStatus>("github_auth_status"),
  signInToGitHub: (token) => invoke<GitHubAuthStatus>("sign_in_to_github", { token }),
  signOutOfGitHub: () => invoke<GitHubAuthStatus>("sign_out_of_github"),
  pullRequests: (path) => invoke<PullRequest[]>("pull_requests", { path }),
  checkGit: () => invoke<GitSetup>("check_git"),
  stageFiles: (path, paths) => invoke<MutationOutcome>("stage_files", { path, paths }),
  unstageFiles: (path, paths) => invoke<MutationOutcome>("unstage_files", { path, paths }),
  stageLines: (path, selection: LineSelection) =>
    invoke<MutationOutcome>("stage_lines", { path, selection }),
  unstageLines: (path, selection: LineSelection) =>
    invoke<MutationOutcome>("unstage_lines", { path, selection }),
  commit: (path, message, options) =>
    invoke<MutationOutcome>("commit", { path, message, options }),
  outgoingCommits: (path) => invoke<OutgoingCommit[]>("outgoing_commits", { path }),
  assessMutation: (path, kind) => invoke<Assessment>("assess_mutation", { path, kind }),
  discardChanges: (path, paths) => invoke<MutationOutcome>("discard_changes", { path, paths }),
  cancelMutation: (mutationId) => invoke<void>("cancel_mutation", { mutationId }),
  currentPullRequest: (path) =>
    invoke<PullRequestDetails | null>("current_pull_request", { path }),
  createPullRequest: (path, title, body, draft) =>
    invoke<PullRequestDetails>("create_pull_request", { path, title, body, draft }),
  updatePullRequest: (path, number, title, body) =>
    invoke<PullRequestDetails>("update_pull_request", { path, number, title, body }),
  markPullRequestReady: (path, number) =>
    invoke<PullRequestDetails>("mark_pull_request_ready", { path, number }),
  openInBrowser: (url) => invoke<void>("open_in_browser", { url }),
  listEditors: () => invoke<Editor[]>("list_editors"),
  openInEditor: (editorId, path) => invoke<void>("open_in_editor", { editorId, path }),
  openFileInEditor: (editorId, worktreePath, file) =>
    invoke<void>("open_file_in_editor", { editorId, worktreePath, file }),
  listTags: (path) => invoke<TagInfo[]>("list_tags", { path }),
  createTagHere: (path, name, message) =>
    invoke<MutationOutcome>("create_tag_here", { path, name, message }),
  deleteTag: (path, name) => invoke<MutationOutcome>("delete_tag", { path, name }),
  pushTag: (path, name, remote) => invoke<MutationOutcome>("push_tag", { path, name, remote }),
  deleteRemoteTag: (path, name, remote) =>
    invoke<MutationOutcome>("delete_remote_tag", { path, name, remote }),
  listRemotes: (path) => invoke<RemoteInfo[]>("list_remotes", { path }),
  addRemote: (path, name, url) => invoke<MutationOutcome>("add_remote", { path, name, url }),
  renameRemote: (path, name, newName) =>
    invoke<MutationOutcome>("rename_remote", { path, name, newName }),
  setRemoteUrl: (path, name, url) => invoke<MutationOutcome>("set_remote_url", { path, name, url }),
  removeRemote: (path, name) => invoke<MutationOutcome>("remove_remote", { path, name }),
  listWorktreeDetails: (path) => invoke<WorktreeDetail[]>("list_worktree_details", { path }),
  createWorktree: (path, target, from: WorktreeStart, newBranch) =>
    invoke<MutationOutcome>("create_worktree", { path, target, from, newBranch }),
  removeWorktree: (path, target, force) =>
    invoke<MutationOutcome>("remove_worktree", { path, target, force }),
  pruneWorktrees: (path) => invoke<MutationOutcome>("prune_worktrees", { path }),
  listStashes: (path) => invoke<StashInfo[]>("list_stashes", { path }),
  stashPreview: (path, stash) => invoke<StashPreview>("stash_preview", { path, stash }),
  stashChanges: (path, message, includeUntracked) =>
    invoke<MutationOutcome>("stash_changes", { path, message, includeUntracked }),
  applyStash: (path, stash) => invoke<MutationOutcome>("apply_stash", { path, stash }),
  popStash: (path, stash) => invoke<MutationOutcome>("pop_stash", { path, stash }),
  dropStash: (path, stash) => invoke<MutationOutcome>("drop_stash", { path, stash }),
  cherryPickCommit: (path, commit) =>
    invoke<MutationOutcome>("cherry_pick_commit", { path, commit }),
  revertCommit: (path, commit) => invoke<MutationOutcome>("revert_commit", { path, commit }),
  resetToCommit: (path, commit, mode: ResetMode) =>
    invoke<MutationOutcome>("reset_to_commit", { path, commit, mode }),
  rebasePlan: (path, from) => invoke<RebasePlan>("rebase_plan", { path, from }),
  applyRebasePlan: (path, plan) => invoke<MutationOutcome>("apply_rebase_plan", { path, plan }),
  conflictFile: (path, file) => invoke<ConflictFile>("conflict_file", { path, file }),
  resolveConflictFile: (path, file, contents) =>
    invoke<MutationOutcome>("resolve_conflict_file", { path, file, contents }),
  resolveConflictWithSide: (path, file, side: ConflictSide) =>
    invoke<MutationOutcome>("resolve_conflict_with_side", { path, file, side }),
  openMergeTool: (path, file) => invoke<MutationOutcome>("open_merge_tool", { path, file }),
  listBranchDetails: (path) => invoke<BranchInfo[]>("list_branch_details", { path }),
  createBranchHere: (path, name, switchTo) =>
    invoke<MutationOutcome>("create_branch_here", { path, name, switch: switchTo }),
  checkoutBranch: (path, name, remote) =>
    invoke<MutationOutcome>("checkout_branch", { path, name, remote }),
  renameBranch: (path, name, newName) =>
    invoke<MutationOutcome>("rename_branch", { path, name, newName }),
  deleteBranch: (path, name) => invoke<MutationOutcome>("delete_branch", { path, name }),
  deleteRemoteBranch: (path, remote, name) =>
    invoke<MutationOutcome>("delete_remote_branch", { path, remote, name }),
  setBranchUpstream: (path, name, upstream) =>
    invoke<MutationOutcome>("set_branch_upstream", { path, name, upstream }),
  mergeBranch: (path, branch, mode: MergeMode) =>
    invoke<MutationOutcome>("merge_branch", { path, branch, mode }),
  rebaseOnto: (path, onto) => invoke<MutationOutcome>("rebase_onto", { path, onto }),
  syncStatus: (path) => invoke<SyncStatus>("sync_status", { path }),
  fetchRemotes: (path) => invoke<MutationOutcome>("fetch_remotes", { path }),
  pullNeedsStrategy: (path) => invoke<boolean>("pull_needs_strategy", { path }),
  pull: (path, strategy, remember) =>
    invoke<MutationOutcome>("pull", { path, strategy, remember }),
  push: (path, force) => invoke<MutationOutcome>("push", { path, force }),
  operationInProgress: (path) =>
    invoke<OperationInProgress | null>("operation_in_progress", { path }),
  continueOperation: (path) => invoke<MutationOutcome>("continue_operation", { path }),
  skipOperation: (path) => invoke<MutationOutcome>("skip_operation", { path }),
  abortOperation: (path) => invoke<MutationOutcome>("abort_operation", { path }),
  checkoutCommit: (path, commit) => invoke<MutationOutcome>("checkout_commit", { path, commit }),
  createBranch: (path, name, commit) =>
    invoke<MutationOutcome>("create_branch", { path, name, commit }),
  createTag: (path, name, commit) => invoke<MutationOutcome>("create_tag", { path, name, commit }),
  rewordLatestCommit: (path, commit, message) =>
    invoke<MutationOutcome>("reword_latest_commit", { path, commit, message }),
  compareWithWorktree: (worktreePath, commit) =>
    invoke<FileChange[]>("compare_with_worktree", { worktreePath, commit }),
  compareFileDiff: (worktreePath, request: WorktreeDiffRequest) =>
    invoke<FileDiff>("compare_file_diff", { worktreePath, request }),
  settings: () => invoke<Settings>("settings"),
  updateSettings: (settings) => invoke<Settings>("update_settings", { settings }),
  gitIdentity: () => invoke<GitIdentity>("git_identity"),
  setGitIdentity: (identity) => invoke<GitIdentity>("set_git_identity", { identity }),
  repositoryGitIdentity: (worktreePath) =>
    invoke<GitIdentity>("repository_git_identity", { worktreePath }),
  setRepositoryGitIdentity: (worktreePath, identity) =>
    invoke<GitIdentity>("set_repository_git_identity", { worktreePath, identity }),
  restoreSession: () => invoke<Session>("restore_session"),
  watchBackgroundTab: (path) => invoke<void>("watch_background_tab", { path }),
  saveView: (view) => invoke<void>("save_view", { view }),
  listRepositories: () => invoke<RepositoryList>("list_repositories"),
  createGroup: (name) => invoke<Group>("create_group", { name }),
  renameGroup: (id, name) => invoke<void>("rename_group", { id, name }),
  moveGroup: (id, index) => invoke<void>("move_group", { id, index }),
  moveRepository: (path, groupId) => invoke<void>("move_repository", { path, groupId }),
  locateRepository: (path, newPath) => invoke<void>("locate_repository", { path, newPath }),
  removeRepository: (path) => invoke<void>("remove_repository", { path }),
  cloneRepository: (url, parent, groupId) =>
    invoke<Tab | null>("clone_repository", { url, parent, groupId }),
  initRepository: (folder, groupId) => invoke<Tab | null>("init_repository", { folder, groupId }),
  scanFolder: (parent) => invoke<FoundRepository[]>("scan_folder", { parent }),
  importRepositories: (paths, groupId) => invoke<void>("import_repositories", { paths, groupId }),
  onEvent: (handler) => listen<CoreEvent>("core-event", ({ payload }) => handler(payload)),
};
