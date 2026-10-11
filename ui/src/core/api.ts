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

export type CoreEvent =
  | { type: "tabOpened"; tab: Tab }
  | { type: "worktreeChanged"; worktreePath: string };

export interface CoreApi {
  /** Rejects with an {@link ApiError} when the folder cannot be opened. */
  openFolder(path: string): Promise<Tab>;
  worktreeStatus(path: string): Promise<WorktreeStatus>;
  /** Makes the core emit `worktreeChanged` whenever files change under the Worktree. */
  watchWorktree(path: string): Promise<void>;
  /**
   * Rows `offset..offset + limit` of the Worktree's history, newest first, laid out by the core.
   * Rejects with an {@link ApiError}.
   */
  historyPage(worktreePath: string, offset: number, limit: number): Promise<HistoryPage>;
  /** Resolves to a function that stops the subscription. */
  onEvent(handler: (event: CoreEvent) => void): Promise<() => void>;
}

export function isApiError(value: unknown): value is ApiError {
  return typeof value === "object" && value !== null && "kind" in value;
}
