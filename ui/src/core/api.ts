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
  /** `start..end` are character offsets into the query text. */
  | { kind: "invalidQuery"; message: string; start: number; end: number }
  | { kind: "notGithub"; path: string }
  | { kind: "githubNotSignedIn" }
  | { kind: "githubTokenRejected" }
  | { kind: "githubRequestFailed"; message: string }
  | { kind: "unexpected"; message: string };

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
}

/** `null` is a value that is not set in the Git configuration. */
export interface GitIdentity {
  name: string | null;
  email: string | null;
}

export const defaultSettings: Settings = {
  diff: { whitespace: "show", defaultMode: "unified" },
  appearance: { codeFontSize: 12 },
};

export type CoreEvent =
  | { type: "tabOpened"; tab: Tab }
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
   * Describes a commit and lists its changed files against its `parent`-th parent. Rejects with
   * an {@link ApiError}.
   */
  commitDetail(worktreePath: string, commit: string, parent: number): Promise<CommitDetail>;
  commitFileDiff(worktreePath: string, request: CommitDiffRequest): Promise<FileDiff>;
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
  commit(path: string, message: string): Promise<MutationOutcome>;
  /** Does nothing for a mutation that has already finished. */
  cancelMutation(mutationId: number): Promise<void>;
  settings(): Promise<Settings>;
  /** Resolves to the settings as stored, with out-of-range values brought back into range. */
  updateSettings(settings: Settings): Promise<Settings>;
  /** The identity in the user's global Git configuration. */
  gitIdentity(): Promise<GitIdentity>;
  /** Writes to the global Git configuration; a blank value removes it. */
  setGitIdentity(identity: GitIdentity): Promise<GitIdentity>;
  /** Resolves to a function that stops the subscription. */
  onEvent(handler: (event: CoreEvent) => void): Promise<() => void>;
}

export function isApiError(value: unknown): value is ApiError {
  return typeof value === "object" && value !== null && "kind" in value;
}
