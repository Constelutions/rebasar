import type { CoreApi, CoreEvent, Tab } from "./api";

/** A fake core that "knows" the given repositories by folder path and never touches Git. */
export function createStubCoreApi(repositories: Record<string, Tab> = {}): CoreApi {
  const handlers = new Set<(event: CoreEvent) => void>();

  return {
    async openFolder(path) {
      const tab = repositories[path];
      if (!tab) {
        throw { kind: "notARepository", path };
      }
      handlers.forEach((handler) => handler({ type: "tabOpened", tab }));
      return tab;
    },
    async onEvent(handler) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
  };
}
