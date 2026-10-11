import type { CoreApi, CoreEvent, Tab, WorktreeStatus } from "./api";

export const emptyStatus: WorktreeStatus = { conflicts: [], staged: [], unstaged: [] };

export interface StubCoreApi extends CoreApi {
  /** Replaces what the Worktree reports, as an edit made outside the app would. */
  changeWorktree(path: string, status: WorktreeStatus): void;
  readonly watchedWorktrees: ReadonlySet<string>;
}

/** A fake core that "knows" the given repositories by folder path and never touches Git. */
export function createStubCoreApi(
  repositories: Record<string, Tab> = {},
  statuses: Record<string, WorktreeStatus> = {},
): StubCoreApi {
  const handlers = new Set<(event: CoreEvent) => void>();
  const current = new Map(Object.entries(statuses));
  const watched = new Set<string>();
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
    async watchWorktree(path) {
      watched.add(path);
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
  };
}
