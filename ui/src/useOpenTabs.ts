import { useCallback, useEffect, useRef, useState } from "react";

import type { CoreApi, Tab, WorktreeStatus } from "./core/api";
import { describeError } from "./core/describeError";

export interface OpenTab {
  tab: Tab;
  /** What the Tab last reported; kept while a refresh is under way so a switch shows it at once. */
  status: WorktreeStatus | null;
  error: string | null;
}

export function useOpenTabs(api: CoreApi) {
  const [openTabs, setOpenTabs] = useState<OpenTab[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [pollingPaths, setPollingPaths] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [restoredView, setRestoredView] = useState<string | null>(null);
  const latestRequests = useRef(new Map<string, number>());

  const refresh = useCallback(
    async (path: string) => {
      const request = (latestRequests.current.get(path) ?? 0) + 1;
      latestRequests.current.set(path, request);
      const [tab, status] = await Promise.allSettled([
        api.refreshTab(path),
        api.worktreeStatus(path),
      ]);
      if (latestRequests.current.get(path) !== request) return;

      setOpenTabs((current) =>
        current.map((open) =>
          open.tab.worktreePath === path
            ? {
                tab: tab.status === "fulfilled" ? tab.value : open.tab,
                status: status.status === "fulfilled" ? status.value : open.status,
                error: status.status === "rejected" ? describeError(status.reason) : null,
              }
            : open,
        ),
      );
    },
    [api],
  );

  const select = useCallback(
    (path: string) => {
      setActivePath(path);
      api.activateTab(path).catch((failure) => setError(describeError(failure)));
      void refresh(path);
    },
    [api, refresh],
  );

  useEffect(() => {
    let cancelled = false;

    async function restore() {
      const session = await api.restoreSession();
      if (cancelled) return;
      setOpenTabs((current) => session.tabs.reduce(withTab, current));
      setRestoredView(session.view);
      if (session.active !== null) select(session.active);

      // One at a time and after a paint, so that many restored Tabs never delay the first one.
      for (const { worktreePath } of session.tabs) {
        if (worktreePath === session.active) continue;
        await nextTask();
        if (cancelled) return;
        await api.watchBackgroundTab(worktreePath).catch(() => {});
        await refresh(worktreePath);
      }
    }

    restore().catch((failure) => setError(describeError(failure)));
    return () => {
      cancelled = true;
    };
  }, [api, refresh, select]);

  useEffect(() => {
    if (activePath === null) return;
    if (openTabs.some((open) => open.tab.worktreePath === activePath)) return;
    const next = openTabs.at(-1);
    if (next) select(next.tab.worktreePath);
    else setActivePath(null);
  }, [openTabs, activePath, select]);

  useEffect(() => {
    const subscription = api.onEvent((event) => {
      switch (event.type) {
        case "tabOpened":
          setOpenTabs((current) => withTab(current, event.tab));
          select(event.tab.worktreePath);
          break;
        case "tabClosed":
          setOpenTabs((current) =>
            current.filter((open) => open.tab.worktreePath !== event.worktreePath),
          );
          break;
        case "worktreeChanged":
          void refresh(event.worktreePath);
          break;
        case "pollingTabsChanged":
          setPollingPaths(event.worktreePaths);
          break;
      }
    });
    return () => {
      void subscription.then((unsubscribe) => unsubscribe());
    };
  }, [api, refresh, select]);

  return {
    openTabs,
    activeTab: openTabs.find((open) => open.tab.worktreePath === activePath),
    pollingPaths,
    restoredView,
    error,
    setError,
    select,
  };
}

function withTab(tabs: OpenTab[], opened: Tab): OpenTab[] {
  if (tabs.some((open) => open.tab.worktreePath === opened.worktreePath)) {
    return tabs.map((open) =>
      open.tab.worktreePath === opened.worktreePath ? { ...open, tab: opened } : open,
    );
  }
  return [...tabs, { tab: opened, status: null, error: null }];
}

function nextTask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
