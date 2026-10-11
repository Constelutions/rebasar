import type {
  CoreApi,
  CoreEvent,
  DiffRequest,
  FileDiff,
  HistoryRow,
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
  readonly watchedWorktrees: ReadonlySet<string>;
  /** Every diff the UI asked for, in order. */
  readonly diffRequests: readonly DiffRequest[];
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
  const watched = new Set<string>();
  const diffRequests: DiffRequest[] = [];
  const emit = (event: CoreEvent) => handlers.forEach((handler) => handler(event));

  return {
    async openFolder(path) {
      const tab = repositories[path];
      if (!tab) {
        throw { kind: "notARepository", path };
      }
      emit({ type: "tabOpened", tab });
      return tab;
    },
    async worktreeStatus(path) {
      return current.get(path) ?? emptyStatus;
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
    async onEvent(handler) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    changeWorktree(path, status) {
      current.set(path, status);
      emit({ type: "worktreeChanged", worktreePath: path });
    },
    watchedWorktrees: watched,
    diffRequests,
  };
}
