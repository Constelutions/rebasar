import { useCallback, useEffect, useRef, useState } from "react";

import type { CoreApi, SyncStatus } from "./core/api";
import { describeError } from "./core/describeError";
import { useSettings } from "./settings/SettingsContext";

const MINUTE = 60_000;

/**
 * How far the Tab in front is from its upstream, kept current by fetching when the Tab is first
 * shown and then on the configured interval. A background fetch that fails is remembered as
 * `fetchFailure` instead of interrupting the user.
 */
export function useSync(api: CoreApi, worktreePath: string | undefined) {
  const { settings, ready } = useSettings();
  const [status, setStatus] = useState<{ worktreePath: string; value: SyncStatus } | null>(null);
  const [fetchFailure, setFetchFailure] = useState<string | null>(null);
  const fetched = useRef(new Set<string>());
  const { autoFetch, fetchIntervalMinutes } = settings.sync;

  const refresh = useCallback(async () => {
    if (worktreePath === undefined) return;
    try {
      setStatus({ worktreePath, value: await api.syncStatus(worktreePath) });
    } catch {
      // A Worktree that cannot be read reports itself through its status elsewhere.
    }
  }, [api, worktreePath]);

  const fetchNow = useCallback(async () => {
    if (worktreePath === undefined) return;
    try {
      const outcome = await api.fetchRemotes(worktreePath);
      setFetchFailure(outcome.kind === "failed" ? "Git could not fetch; see the output panel." : null);
    } catch (failure) {
      setFetchFailure(describeError(failure));
    }
    await refresh();
  }, [api, worktreePath, refresh]);

  useEffect(() => {
    setFetchFailure(null);
    void refresh();
    if (worktreePath === undefined) return;
    const subscription = api.onEvent((event) => {
      if (event.type === "worktreeChanged" && event.worktreePath === worktreePath) void refresh();
    });
    return () => {
      void subscription.then((unsubscribe) => unsubscribe());
    };
  }, [api, worktreePath, refresh]);

  useEffect(() => {
    if (worktreePath === undefined || !ready || !autoFetch) return;
    if (!fetched.current.has(worktreePath)) {
      fetched.current.add(worktreePath);
      void fetchNow();
    }
    const timer = setInterval(() => void fetchNow(), fetchIntervalMinutes * MINUTE);
    return () => clearInterval(timer);
  }, [worktreePath, ready, autoFetch, fetchIntervalMinutes, fetchNow]);

  return {
    status: status !== null && status.worktreePath === worktreePath ? status.value : null,
    fetchFailure,
    fetchNow,
    refresh,
  };
}
