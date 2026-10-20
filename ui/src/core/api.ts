export type Head =
  | { kind: "branch"; name: string }
  | { kind: "detached"; commit: string };

export interface Tab {
  repositoryName: string;
  worktreePath: string;
  head: Head;
}

export type ApiError =
  | { kind: "folderNotFound"; path: string }
  | { kind: "notARepository"; path: string }
  | { kind: "groupNotFound"; id: string }
  | { kind: "repositoryNotFound"; path: string }
  | { kind: "invalidGroupName" }
  | { kind: "alreadyARepository"; path: string }
  | { kind: "invalidRepositoryUrl"; url: string }
  | { kind: "gitFailed"; message: string }
  /** `start..end` are character offsets into the query text. */
  | { kind: "invalidQuery"; message: string; start: number; end: number }
  | PullRequestsUnavailable
  | { kind: "githubTokenRejected" }
  | { kind: "githubRequestFailed"; message: string }
  | { kind: "unexpected"; message: string };

/** Why the Pull requests of a Repository cannot be shown. */
export type PullRequestsUnavailableReason =
  | { kind: "noRemotes" }
  | { kind: "notGithub"; host: string }
  | { kind: "unexpectedPath"; path: string }
  | { kind: "aliasUnresolved"; alias: string; detail: string }
  | { kind: "noToken" }
  | { kind: "tokenRejected" }
  | { kind: "repositoryNotVisible"; repository: string }
  | { kind: "requestFailed"; message: string };

export interface PullRequestsUnavailable {
  kind: "pullRequestsUnavailable";
  reason: PullRequestsUnavailableReason;
  message: string;
  /** The remote that was looked at, when there was one. */
  url: string | null;
  hint: string | null;
}

/** A commit the command palette offers to jump to. */
export interface CommitHit {
  id: string;
  shortId: string;
  subject: string;
  authorName: string;
  /** Seconds since the Unix epoch. */
  timestamp: number;
}

export type ChangeKind =
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "typeChanged"
  | "untracked"
  | "conflicted";

export interface FileChange {
  path: string;
  originalPath: string | null;
  kind: ChangeKind;
  /** `null` for binary and oversized files, which have no line counts. */
  added: number | null;
  removed: number | null;
}

export interface WorktreeStatus {
  conflicts: FileChange[];
  staged: FileChange[];
  unstaged: FileChange[];
}

export type EdgeKind = "through" | "incoming" | "outgoing";

/** A line of the commit graph; `lane` is the column where it touches the row's top or bottom edge. */
export interface Edge {
  kind: EdgeKind;
  lane: number;
}

export type RefKind = "head" | "localBranch" | "remoteBranch" | "tag";

export interface RefLabel {
  kind: RefKind;
  name: string;
}

export interface HistoryRow {
  id: string;
  shortId: string;
  subject: string;
  authorName: string;
  authorEmail: string;
  /** Seconds since the Unix epoch. */
  timestamp: number;
  /** The column of the commit's dot. */
  lane: number;
  laneCount: number;
  edges: Edge[];
  refs: RefLabel[];
}

export interface HistoryPage {
  offset: number;
  rows: HistoryRow[];
  hasMore: boolean;
}

/** What the History filter bar asks for: the typed query plus the quick chips. */
export interface HistoryFilter {
  query: string;
  /** Off narrows History to the commits reachable from HEAD. */
  allBranches: boolean;
  mine: boolean;
  merges: boolean;
}

export const unfilteredHistory: HistoryFilter = {
  query: "",
  allBranches: true,
  mine: false,
  merges: false,
};

export interface HistoryCount {
  matching: number;
  total: number;
}

export type WhitespaceMode = "show" | "ignoreAll";

export type DiffMode = "unified" | "sideBySide";

export type ChangeList = "conflicts" | "staged" | "unstaged";

export interface DiffRequest {
  path: string;
  originalPath: string | null;
  list: ChangeList;
  /** Computes the diff of a file that would otherwise come back collapsed. */
  loadLarge?: boolean;
  whitespace?: WhitespaceMode;
}

export type LineKind = "context" | "added" | "removed";

/** The added and removed lines picked in the diff of one file, exactly as the diff showed them. */
export interface LineSelection {
  path: string;
  originalPath: string | null;
  lines: DiffLine[];
}

export interface DiffLine {
  kind: LineKind;
  oldNumber: number | null;
  newNumber: number | null;
  text: string;
}

export interface Hunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

export type DiffContent =
  | { kind: "text"; hunks: Hunk[] }
  | { kind: "binary"; oldBytes: number | null; newBytes: number | null }
  | { kind: "collapsed"; bytes: number; lines: number | null };

export interface FileDiff {
  path: string;
  originalPath: string | null;
  /** File modes in octal, as Git prints them. */
  modeChange: { old: string; new: string } | null;
  content: DiffContent;
}

export interface GitHubRepository {
  owner: string;
  name: string;
}

export type TokenSource = "ghCli" | "personalAccessToken";

export interface GitHubAuthStatus {
  /** `null` when nobody is signed in. */
  source: TokenSource | null;
}

export type CheckState = "none" | "pending" | "success" | "failure";
export type ReviewState = "none" | "reviewRequired" | "changesRequested" | "approved";

export interface PullRequest {
  number: number;
  title: string;
  url: string;
  author: string;
  headBranch: string;
  baseBranch: string;
  isDraft: boolean;
  checks: CheckState;
  review: ReviewState;
}

export interface CommitOptions {
  /** Replaces the previous commit instead of adding a new one. */
  amend: boolean;
  signOff: boolean;
}

/** A commit on the current branch that its upstream does not have yet. */
export interface OutgoingCommit {
  id: string;
  shortId: string;
  subject: string;
}

export type GitSetup =
  | { kind: "ready"; version: string }
  | { kind: "missing"; minimum: string }
  | { kind: "tooOld"; version: string; minimum: string };

/** A Git command that changes a Repository; the core runs them one at a time per Repository. */
export interface MutationInfo {
  id: number;
  worktreePath: string;
  title: string;
}

export type MutationOutcome =
  | { kind: "succeeded" }
  | { kind: "failed"; exitCode: number | null }
  | { kind: "cancelled" };

export type OutputStream = "stdout" | "stderr";

export interface Settings {
  diff: { whitespace: WhitespaceMode; defaultMode: DiffMode };
  appearance: { codeFontSize: number };
  sync: { autoFetch: boolean; fetchIntervalMinutes: number };
}

/** `null` is a value that is not set in the Git configuration. */
export interface GitIdentity {
  name: string | null;
  email: string | null;
}

export const defaultSettings: Settings = {
  diff: { whitespace: "show", defaultMode: "unified" },
  appearance: { codeFontSize: 12 },
  sync: { autoFetch: true, fetchIntervalMinutes: 5 },
};

export interface Group {
  id: string;
  name: string;
}

export interface WorktreeEntry {
  path: string;
  main: boolean;
  head: Head;
}

/** A Repository a scan came across. */
export interface FoundRepository {
  path: string;
  name: string;
  /** Importing it would change nothing. */
  alreadyAdded: boolean;
}

export interface RepositoryEntry {
  path: string;
  name: string;
  /** `null` for a Repository in the default 'Ungrouped' section. */
  groupId: string | null;
  /** Its folder is gone; it has no Worktrees until it is located again or removed. */
  missing: boolean;
  /** The main Worktree first. */
  worktrees: WorktreeEntry[];
}

export interface RepositoryList {
  /** In the order the user arranged them. */
  groups: Group[];
  repositories: RepositoryEntry[];
}

/** What the user had open when the app last ran. */
export interface Session {
  /** In the order they were opened, as last seen: nothing has been read from Git yet. */
  tabs: Tab[];
  active: string | null;
  view: string | null;
}

/** A Mutation about to be requested; see `docs/confirmation-policy.md`. */
export type MutationKind =
  | { kind: "stage" }
  | { kind: "unstage" }
  | { kind: "commit" }
  | { kind: "discardChanges"; paths: string[] }
  | { kind: "abortOperation" }
  | { kind: "forcePush" }
  | { kind: "deleteBranch"; name: string }
  | { kind: "reset"; commit: string; mode: ResetMode }
  | { kind: "dropStash"; stash: string }
  | { kind: "removeWorktree"; path: string }
  | { kind: "deleteTag"; name: string }
  | { kind: "deleteRemoteTag"; name: string; remote: string };

/** Exactly what a destructive Mutation would lose, as it stands right now. */
export interface Loss {
  /** Files with uncommitted work that would be overwritten or deleted. */
  files: FileChange[];
  /** Commits that would no longer be reachable from any branch. */
  commits: number;
  /** How many of those commits exist on no remote. */
  unpushedCommits: number;
}

export type Assessment = { kind: "safe" } | { kind: "destructive"; loss: Loss };

export type CoreEvent =
  | { type: "tabOpened"; tab: Tab }
  | { type: "tabClosed"; worktreePath: string }
  | { type: "worktreeChanged"; worktreePath: string }
  | { type: "pollingTabsChanged"; worktreePaths: string[] }
  | { type: "mutationQueued"; mutation: MutationInfo }
  | { type: "mutationStarted"; mutationId: number }
  /** A `transient` line is a progress update that the next line replaces. */
  | {
      type: "mutationOutput";
      mutationId: number;
      stream: OutputStream;
      text: string;
      transient: boolean;
    }
  | { type: "mutationFinished"; mutationId: number; outcome: MutationOutcome };

export interface CommitParent {
  id: string;
  shortId: string;
  subject: string;
}

export interface CommitDetail {
  id: string;
  shortId: string;
  authorName: string;
  authorEmail: string;
  /** Seconds since the Unix epoch. */
  authorTimestamp: number;
  /** The full message, subject first. */
  message: string;
  parents: CommitParent[];
  /** The files that differ from the parent the commit was read against. */
  files: FileChange[];
}

export interface CommitDiffRequest {
  commit: string;
  /** Index into the commit's parents; ignored for a root commit. */
  parent: number;
  path: string;
  originalPath: string | null;
  /** Computes the diff of a file that would otherwise come back collapsed. */
  loadLarge?: boolean;
}

export type OperationKind = "merge" | "rebase" | "cherryPick" | "revert";

/** Git is paused in the middle of this operation, however it was started. */
export interface OperationInProgress {
  kind: OperationKind;
  /** Known for a rebase. */
  step: { current: number; total: number } | null;
  /** Files still waiting for a resolution. */
  conflicts: number;
  /** A merge has a single step, so there is nothing to skip. */
  canSkip: boolean;
}

export interface SyncStatus {
  /** `null` while HEAD is detached. */
  branch: string | null;
  /** `null` for a branch that was never pushed, whose commits all count as ahead. */
  upstream: string | null;
  ahead: number;
  behind: number;
}

export type PullStrategy = "merge" | "rebase";

export interface BranchInfo {
  /** `main` for a local branch, `origin/main` for a remote one. */
  name: string;
  kind: "local" | "remote";
  /** The branch HEAD is on. */
  current: boolean;
  /** Only local branches track one. */
  upstream: string | null;
  ahead: number;
  behind: number;
  /** Everything on the branch is already part of the current branch. */
  merged: boolean;
  shortId: string;
}

export type MergeMode = "default" | "noFastForward" | "squash";

export type ConflictKind = "text" | "binary" | "deleteModify" | "unsupported";

export type ConflictSide = "ours" | "theirs";

/** A stretch of a conflicted file with its conflict markers read back out of it. */
export type ConflictSegment =
  | { kind: "text"; text: string }
  | { kind: "conflict"; ours: string; theirs: string };

export interface ConflictFile {
  path: string;
  kind: ConflictKind;
  /** The file as the current branch has it; empty where it deleted it, and for a binary file. */
  ours: string;
  theirs: string;
  /** The file on disk cut at its conflict markers; only for a text conflict. */
  segments: ConflictSegment[];
  /** Which side deleted the file in a delete/modify conflict. */
  deletedBy: ConflictSide | null;
  /** Whether `merge.tool` is set, so an unsupported conflict can be handed to it. */
  mergeToolConfigured: boolean;
}

/** Keeps the changes staged, keeps them unstaged, or throws them away with everything uncommitted. */
export type ResetMode = "soft" | "mixed" | "hard";

export interface StashInfo {
  /** The stash commit. Every action names a stash by it, never by its position. */
  id: string;
  shortId: string;
  /** What the user typed, or Git's own `WIP on main: abc1234 subject`. */
  message: string;
  /** The branch it was made on; empty when Git did not record one. */
  branch: string;
  /** Seconds since the Unix epoch. */
  timestamp: number;
}

export interface StashPreview {
  /** The tracked files the stash changes; read their diffs with `commitFileDiff` against parent 0. */
  files: FileChange[];
  /** Files that were untracked when the stash was made. */
  untracked: string[];
}

/** A pull request with the text a user can edit. */
export interface PullRequestDetails {
  number: number;
  title: string;
  body: string;
  url: string;
  isDraft: boolean;
}

export interface TagInfo {
  name: string;
  /** An annotated tag is an object of its own, with a message. */
  annotated: boolean;
  /** The commit the tag points at. */
  shortId: string;
  subject: string;
}

export interface RemoteInfo {
  name: string;
  url: string;
  /** Empty when pushes go to the same address. */
  pushUrl: string;
}

export interface WorktreeDetail {
  path: string;
  /** The Worktree that holds the Repository itself; it cannot be removed. */
  main: boolean;
  head: Head;
  /** It has changes that are not committed, untracked files included. */
  dirty: boolean;
  /** The Worktree the question was asked from. */
  current: boolean;
}

/** What a new Worktree starts from. */
export type WorktreeStart = { kind: "branch"; name: string } | { kind: "commit"; id: string };

export type PlanAction = "pick" | "reword" | "squash" | "fixup" | "drop" | "edit";

export type RebasePlanEntry =
  | {
      kind: "commit";
      /** `edit` only ever comes from a rebase in progress; it cannot be chosen. */
      action: PlanAction;
      commit: string;
      shortId: string;
      subject: string;
      /** The commit's message; what a `reword` replaces. */
      message: string;
    }
  /** An `exec`, `break` or other step, kept as it is. */
  | { kind: "line"; text: string };

export interface RebasePlan {
  /** The commit to replay onto; `null` from a root commit and for a rebase in progress. */
  onto: string | null;
  /** The plan is what is left of a rebase that stopped, not a new one. */
  inProgress: boolean;
  /** Oldest first, the order the commits are replayed in. */
  entries: RebasePlanEntry[];
}

export interface WorktreeDiffRequest {
  commit: string;
  path: string;
  /** Computes the diff of a file that would otherwise come back collapsed. */
  loadLarge?: boolean;
}

export interface CoreApi {
  /** Rejects with an {@link ApiError} when the folder cannot be opened. */
  openFolder(path: string): Promise<Tab>;
  worktreeStatus(path: string): Promise<WorktreeStatus>;
  fileDiff(path: string, request: DiffRequest): Promise<FileDiff>;
  /** Makes the core emit `worktreeChanged` whenever files change under the Worktree. */
  watchWorktree(path: string): Promise<void>;
  /**
   * Rows `offset..offset + limit` of the Worktree's history, newest first, laid out by the core
   * from the commits `filter` lets through. Rejects with an {@link ApiError}, `invalidQuery`
   * when the query is malformed.
   */
  historyPage(
    worktreePath: string,
    offset: number,
    limit: number,
    filter: HistoryFilter,
  ): Promise<HistoryPage>;
  /** How many commits `filter` lets through, out of all of them. Rejects like `historyPage`. */
  historyCount(worktreePath: string, filter: HistoryFilter): Promise<HistoryCount>;
  /**
   * The newest `limit` commits of every branch that match `query`, in the History filter's
   * syntax; a query that is one hexadecimal word also finds commits by hash, ahead of the rest.
   * Rejects like `historyPage`.
   */
  findCommits(worktreePath: string, query: string, limit: number): Promise<CommitHit[]>;
  /** The local and remote branches of the Worktree's Repository, sorted by name. */
  listBranches(worktreePath: string): Promise<RefLabel[]>;
  /**
   * Describes a commit and lists its changed files against its `parent`-th parent. Rejects with
   * an {@link ApiError}.
   */
  commitDetail(worktreePath: string, commit: string, parent: number): Promise<CommitDetail>;
  commitFileDiff(worktreePath: string, request: CommitDiffRequest): Promise<FileDiff>;
  /** The tracked files whose content on disk differs from the commit. */
  compareWithWorktree(worktreePath: string, commit: string): Promise<FileChange[]>;
  compareFileDiff(worktreePath: string, request: WorktreeDiffRequest): Promise<FileDiff>;
  /** Makes the Tab the most recently used one, so it keeps its caches and a live watcher. */
  activateTab(path: string): Promise<void>;
  /** Reads the Tab again, so that a branch switched outside the app shows. */
  refreshTab(path: string): Promise<Tab>;
  /** `null` when none of the Repository's remotes is on GitHub. */
  githubRemote(path: string): Promise<GitHubRepository | null>;
  githubAuthStatus(): Promise<GitHubAuthStatus>;
  /** Rejects with `githubTokenRejected` when GitHub does not accept the token. */
  signInToGitHub(token: string): Promise<GitHubAuthStatus>;
  /** Forgets a pasted token; a `gh` CLI sign-in stays. */
  signOutOfGitHub(): Promise<GitHubAuthStatus>;
  /** Open pull requests of the Repository's GitHub remote, most recently updated first. */
  pullRequests(path: string): Promise<PullRequest[]>;
  checkGit(): Promise<GitSetup>;
  /**
   * The mutation methods resolve when the mutation has finished, after waiting for earlier
   * ones on the same Repository; follow its progress through the `mutation*` events.
   */
  stageFiles(path: string, paths: string[]): Promise<MutationOutcome>;
  /** For a renamed file pass both its paths. */
  unstageFiles(path: string, paths: string[]): Promise<MutationOutcome>;
  /** Rejects when the file no longer matches the diff the lines were picked from. */
  stageLines(path: string, selection: LineSelection): Promise<MutationOutcome>;
  unstageLines(path: string, selection: LineSelection): Promise<MutationOutcome>;
  /** An amend with an empty message keeps the previous commit's message. */
  commit(path: string, message: string, options: CommitOptions): Promise<MutationOutcome>;
  /** Newest first. */
  outgoingCommits(path: string): Promise<OutgoingCommit[]>;
  /**
   * Asks whether the Mutation can lose work. Ask before every Mutation that might, and confirm
   * with the user when the answer is `destructive`; see `useConfirmation`.
   */
  assessMutation(path: string, kind: MutationKind): Promise<Assessment>;
  /**
   * Throws away the unstaged changes to the files: tracked files go back to the index version,
   * untracked files are deleted. Never call it without confirming a destructive assessment.
   */
  discardChanges(path: string, paths: string[]): Promise<MutationOutcome>;
  /** Does nothing for a mutation that has already finished. */
  cancelMutation(mutationId: number): Promise<void>;
  /** The open pull request of the branch the Worktree is on; `null` when there is none. */
  currentPullRequest(path: string): Promise<PullRequestDetails | null>;
  /** Opens the current branch, which must be pushed, against the default branch. */
  createPullRequest(path: string, title: string, body: string, draft: boolean): Promise<PullRequestDetails>;
  updatePullRequest(path: string, number: number, title: string, body: string): Promise<PullRequestDetails>;
  markPullRequestReady(path: string, number: number): Promise<PullRequestDetails>;
  /** Only `https` addresses. */
  openInBrowser(url: string): Promise<void>;
  listTags(path: string): Promise<TagInfo[]>;
  /** At the current commit; annotated when a message is given. */
  createTagHere(path: string, name: string, message: string | null): Promise<MutationOutcome>;
  /** Confirm with `{ kind: "deleteTag", name }` first. */
  deleteTag(path: string, name: string): Promise<MutationOutcome>;
  pushTag(path: string, name: string, remote: string): Promise<MutationOutcome>;
  /** Confirm with `{ kind: "deleteRemoteTag", name, remote }` first; the local tag stays. */
  deleteRemoteTag(path: string, name: string, remote: string): Promise<MutationOutcome>;
  listRemotes(path: string): Promise<RemoteInfo[]>;
  addRemote(path: string, name: string, url: string): Promise<MutationOutcome>;
  renameRemote(path: string, name: string, newName: string): Promise<MutationOutcome>;
  setRemoteUrl(path: string, name: string, url: string): Promise<MutationOutcome>;
  removeRemote(path: string, name: string): Promise<MutationOutcome>;
  /** The Worktrees of the Repository the Tab belongs to, the main one first. */
  listWorktreeDetails(path: string): Promise<WorktreeDetail[]>;
  /** A branch start checks it out; with `newBranch` that branch is created; a bare commit detaches. */
  createWorktree(
    path: string,
    target: string,
    from: WorktreeStart,
    newBranch: string | null,
  ): Promise<MutationOutcome>;
  /** Closes the Worktree's Tab. Confirm with `{ kind: "removeWorktree", path }` first, then force. */
  removeWorktree(path: string, target: string, force: boolean): Promise<MutationOutcome>;
  /** Forgets Worktrees whose folder is gone. */
  pruneWorktrees(path: string): Promise<MutationOutcome>;
  /** Newest first. */
  listStashes(path: string): Promise<StashInfo[]>;
  stashPreview(path: string, stash: string): Promise<StashPreview>;
  /** Does nothing, successfully, when there is nothing to park. */
  stashChanges(
    path: string,
    message: string | null,
    includeUntracked: boolean,
  ): Promise<MutationOutcome>;
  /** A conflict leaves conflicted files for the Conflicts view, and `pop` keeps the stash. */
  applyStash(path: string, stash: string): Promise<MutationOutcome>;
  popStash(path: string, stash: string): Promise<MutationOutcome>;
  /** Confirm with `{ kind: "dropStash", stash }` first. */
  dropStash(path: string, stash: string): Promise<MutationOutcome>;
  /** A conflict leaves the Worktree paused for the banner and the Conflicts view. */
  cherryPickCommit(path: string, commit: string): Promise<MutationOutcome>;
  revertCommit(path: string, commit: string): Promise<MutationOutcome>;
  /** Confirm with `{ kind: "reset", commit, mode }` first. */
  resetToCommit(path: string, commit: string, mode: ResetMode): Promise<MutationOutcome>;
  /**
   * The commits a rebase starting at `from` would replay, all set to pick. Without `from`, what
   * is left of the rebase in progress.
   */
  rebasePlan(path: string, from: string | null): Promise<RebasePlan>;
  /** Replays the plan without an editor; a conflict leaves the Worktree for the banner. */
  applyRebasePlan(path: string, plan: RebasePlan): Promise<MutationOutcome>;
  conflictFile(path: string, file: string): Promise<ConflictFile>;
  /** Saves the contents as the resolved file and stages it, which marks it resolved. */
  resolveConflictFile(path: string, file: string, contents: string): Promise<MutationOutcome>;
  /** Keeps one side's version whole; deletes the file when that side deleted it. */
  resolveConflictWithSide(path: string, file: string, side: ConflictSide): Promise<MutationOutcome>;
  /** Opens the file in the user's configured merge tool. */
  openMergeTool(path: string, file: string): Promise<MutationOutcome>;
  /** Local branches first, then remote ones, each by name. */
  listBranchDetails(path: string): Promise<BranchInfo[]>;
  /** At the current commit; the Worktree switches to it only when `switchTo` is set. */
  createBranchHere(path: string, name: string, switchTo: boolean): Promise<MutationOutcome>;
  /** A remote branch gets a local branch of the same name that tracks it. */
  checkoutBranch(path: string, name: string, remote: boolean): Promise<MutationOutcome>;
  renameBranch(path: string, name: string, newName: string): Promise<MutationOutcome>;
  /** Confirm with `{ kind: "deleteBranch", name }` first. */
  deleteBranch(path: string, name: string): Promise<MutationOutcome>;
  /** `null` stops the branch tracking anything. */
  setBranchUpstream(path: string, name: string, upstream: string | null): Promise<MutationOutcome>;
  /** A merge or rebase that stops on a conflict leaves the Worktree for the banner to show. */
  mergeBranch(path: string, branch: string, mode: MergeMode): Promise<MutationOutcome>;
  rebaseOnto(path: string, onto: string): Promise<MutationOutcome>;
  /** As of the last fetch; fetching is what brings it up to date. */
  syncStatus(path: string): Promise<SyncStatus>;
  /** Never prompts for credentials. Rejects with an error that has next steps when they fail. */
  fetchRemotes(path: string): Promise<MutationOutcome>;
  /** True when the branch has diverged and neither `pull.rebase` nor `pull.ff` says what to do. */
  pullNeedsStrategy(path: string): Promise<boolean>;
  /** Follows the user's Git configuration unless `strategy` is given; `remember` saves it. */
  pull(path: string, strategy: PullStrategy | null, remember: boolean): Promise<MutationOutcome>;
  /** A forced push always uses `--force-with-lease`; confirm with `{ kind: "forcePush" }` first. */
  push(path: string, force: boolean): Promise<MutationOutcome>;
  /** `null` when the Worktree is not paused in the middle of an operation. */
  operationInProgress(path: string): Promise<OperationInProgress | null>;
  /** Finishes the operation; `failed` while conflicts are left. */
  continueOperation(path: string): Promise<MutationOutcome>;
  /** Drops the commit the operation is stopped on. Rejects for a merge. */
  skipOperation(path: string): Promise<MutationOutcome>;
  /** Confirm with `{ kind: "abortOperation" }` first. */
  abortOperation(path: string): Promise<MutationOutcome>;
  /** Detaches HEAD at the commit; `failed` if that would overwrite local changes. */
  checkoutCommit(path: string, commit: string): Promise<MutationOutcome>;
  /** Does not switch to the new branch. `failed` if Git rejects the name. */
  createBranch(path: string, name: string, commit: string): Promise<MutationOutcome>;
  /** A lightweight tag. `failed` if Git rejects the name or the tag exists. */
  createTag(path: string, name: string, commit: string): Promise<MutationOutcome>;
  /**
   * Replaces the message of the commit HEAD points at. Rejects with an {@link ApiError} when
   * `commit` is no longer that commit.
   */
  rewordLatestCommit(path: string, commit: string, message: string): Promise<MutationOutcome>;
  settings(): Promise<Settings>;
  /** Resolves to the settings as stored, with out-of-range values brought back into range. */
  updateSettings(settings: Settings): Promise<Settings>;
  /** The identity in the user's global Git configuration. */
  gitIdentity(): Promise<GitIdentity>;
  /** Writes to the global Git configuration; a blank value removes it. */
  setGitIdentity(identity: GitIdentity): Promise<GitIdentity>;
  /** The identity in the Repository's own Git configuration; `null` values fall back to the global one. */
  repositoryGitIdentity(worktreePath: string): Promise<GitIdentity>;
  /** Writes to the Repository's local Git configuration, shared by all its Worktrees; a blank value removes it. */
  setRepositoryGitIdentity(worktreePath: string, identity: GitIdentity): Promise<GitIdentity>;
  /** The Tabs and view to show on launch; Tabs whose folders are gone are already left out. */
  restoreSession(): Promise<Session>;
  /** Watches a restored Tab without making it the most recently used one. */
  watchBackgroundTab(path: string): Promise<void>;
  saveView(view: string): Promise<void>;
  /** Lists every Repository; Tabs of Repositories found missing close with a `tabClosed` event. */
  listRepositories(): Promise<RepositoryList>;
  createGroup(name: string): Promise<Group>;
  renameGroup(id: string, name: string): Promise<void>;
  /** Puts the Group at `index` among the Groups. */
  moveGroup(id: string, index: number): Promise<void>;
  /** `null` returns the Repository to 'Ungrouped'. */
  moveRepository(path: string, groupId: string | null): Promise<void>;
  /** Points a missing Repository at the folder it moved to; rejects when that is not a Repository. */
  locateRepository(path: string, newPath: string): Promise<void>;
  /** Forgets the Repository and closes its Tabs; its folder is left alone. */
  removeRepository(path: string): Promise<void>;
  /**
   * Clones into a new folder named after the Repository inside `parent` and opens it as a Tab.
   * Progress streams as a mutation; resolves to `null` when cancelled.
   */
  cloneRepository(url: string, parent: string, groupId: string | null): Promise<Tab | null>;
  /** Resolves to `null` when cancelled. */
  initRepository(folder: string, groupId: string | null): Promise<Tab | null>;
  /** A one-time look below `parent`; nothing is remembered. */
  scanFolder(parent: string): Promise<FoundRepository[]>;
  /** Adds the Repositories without opening Tabs. */
  importRepositories(paths: string[], groupId: string | null): Promise<void>;
  /** Resolves to a function that stops the subscription. */
  onEvent(handler: (event: CoreEvent) => void): Promise<() => void>;
}

export function isApiError(value: unknown): value is ApiError {
  return typeof value === "object" && value !== null && "kind" in value;
}
