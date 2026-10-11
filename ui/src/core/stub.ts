import type {
  CoreApi,
  CoreEvent,
  DiffRequest,
  FileDiff,
  HistoryRow,
  Head,
  Tab,
  WorktreeStatus,
} from "./api";

export const emptyStatus: WorktreeStatus = { conflicts: [], staged: [], unstaged: [] };

export function diffKey({ list, path }: Pick<DiffRequest, "list" | "path">) {
  return `${list}:${path}`;
}

export interface StubCoreApi extends CoreApi {
  /** Replaces what the Worktree reports, as an edit made outside the app would. */
  changeWorktree(path: string, status: WorktreeStatus): void;
  /** Switches the branch of a Worktree outside the app and reports it as a change. */
  checkOut(path: string, head: Head): void;
  /** Reports which Tabs the core has fallen back to polling, as when the watch limit is hit. */
  setPolling(paths: string[]): void;
  /** Makes status reads wait until the returned function is called. */
  holdStatusReads(): () => void;
  readonly watchedWorktrees: ReadonlySet<string>;
  /** Every diff the UI asked for, in order. */
  readonly diffRequests: readonly DiffRequest[];
  /** The Tab the user last activated, as the core sees it. */
  readonly activeWorktree: string | null;
}

/**
 * A fake core that "knows" the given repositories by folder path and never touches Git.
 * `histories` holds each Worktree's commits, already laid out, newest first; the stub shows all
 * of them whatever the filter, as filtering is the core's business. Diffs are keyed by
 * {@link diffKey}; a file without one has no content changes.
 */
export function createStubCoreApi(
  repositories: Record<string, Tab> = {},
  statuses: Record<string, WorktreeStatus> = {},
  histories: Record<string, HistoryRow[]> = {},
  diffs: Record<string, FileDiff> = {},
): StubCoreApi {
  const handlers = new Set<(event: CoreEvent) => void>();
  const current = new Map(Object.entries(statuses));
  const tabs = new Map(Object.entries(repositories));
  const watched = new Set<string>();
  const diffRequests: DiffRequest[] = [];
  const emit = (event: CoreEvent) => handlers.forEach((handler) => handler(event));
  let active: string | null = null;
  let held: Promise<void> | null = null;

  function known(path: string): Tab {
    const tab = tabs.get(path);
    if (!tab) {
      throw { kind: "notARepository", path };
    }
    return tab;
  }

  return {
    async openFolder(path) {
      const tab = known(path);
      emit({ type: "tabOpened", tab });
      return tab;
    },
    async worktreeStatus(path) {
      const snapshot = current.get(path) ?? emptyStatus;
      await held;
      return snapshot;
    },
    async fileDiff(_path, request) {
      diffRequests.push(request);
      return (
        diffs[diffKey(request)] ?? {
          path: request.path,
          originalPath: request.originalPath,
          modeChange: null,
          content: { kind: "text", hunks: [] },
        }
      );
    },
    async watchWorktree(path) {
      watched.add(path);
    },
    async historyPage(worktreePath, offset, limit) {
      const rows = histories[worktreePath] ?? [];
      return {
        offset,
        rows: rows.slice(offset, offset + limit),
        hasMore: rows.length > offset + limit,
      };
    },
    async historyCount(worktreePath) {
      const total = (histories[worktreePath] ?? []).length;
      return { matching: total, total };
    },
    async activateTab(path) {
      known(path);
      watched.add(path);
      active = path;
    },
    async refreshTab(path) {
      return known(path);
    },
    async onEvent(handler) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    changeWorktree(path, status) {
      current.set(path, status);
      emit({ type: "worktreeChanged", worktreePath: path });
    },
    checkOut(path, head) {
      tabs.set(path, { ...known(path), head });
      emit({ type: "worktreeChanged", worktreePath: path });
    },
    setPolling(paths) {
      emit({ type: "pollingTabsChanged", worktreePaths: paths });
    },
    holdStatusReads() {
      let release = () => {};
      held = new Promise<void>((resolve) => {
        release = resolve;
      });
      return () => {
        release();
        held = null;
      };
    },
    watchedWorktrees: watched,
    diffRequests,
    get activeWorktree() {
      return active;
    },
  };
}
