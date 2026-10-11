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

export type ChangeList = "conflicts" | "staged" | "unstaged";

export interface DiffRequest {
  path: string;
  originalPath: string | null;
  list: ChangeList;
  /** Computes the diff of a file that would otherwise come back collapsed. */
  loadLarge?: boolean;
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

export type CoreEvent =
  | { type: "tabOpened"; tab: Tab }
  | { type: "worktreeChanged"; worktreePath: string }
  | { type: "pollingTabsChanged"; worktreePaths: string[] };

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
  /** Resolves to a function that stops the subscription. */
  onEvent(handler: (event: CoreEvent) => void): Promise<() => void>;
}

export function isApiError(value: unknown): value is ApiError {
  return typeof value === "object" && value !== null && "kind" in value;
}
