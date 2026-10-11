import { useCallback, useEffect, useRef, useState } from "react";

import type { CoreApi, HistoryPage } from "../core/api";
import { describeError } from "../core/describeError";
import { type HistoryItem, appendRows } from "./items";

export const PAGE_SIZE = 100;

interface HistoryState {
  items: HistoryItem[];
  laneCount: number;
  loaded: boolean;
  error: string | null;
}

const empty: HistoryState = { items: [], laneCount: 1, loaded: false, error: null };

function withPage(state: HistoryState, page: HistoryPage): HistoryState {
  return {
    items: appendRows(state.items, page.rows),
    laneCount: page.rows.reduce((widest, row) => Math.max(widest, row.laneCount), state.laneCount),
    loaded: true,
    error: null,
  };
}

/** Loads a Worktree's history one page at a time; `loadMore` fetches the next page. */
export function useHistory(api: CoreApi, worktreePath: string) {
  const [state, setState] = useState<HistoryState>(empty);
  const loadNextPage = useRef<() => void>(() => {});

  useEffect(() => {
    let active = true;
    let loadedRows = 0;
    let hasMore = true;
    let loading = false;

    setState(empty);
    loadNextPage.current = () => {
      if (!active || loading || !hasMore) return;
      loading = true;
      api.historyPage(worktreePath, loadedRows, PAGE_SIZE).then(
        (page) => {
          loading = false;
          if (!active) return;
          loadedRows += page.rows.length;
          hasMore = page.hasMore;
          setState((current) => withPage(current, page));
        },
        (failure) => {
          loading = false;
          if (!active) return;
          hasMore = false;
          setState((current) => ({ ...current, loaded: true, error: describeError(failure) }));
        },
      );
    };
    loadNextPage.current();

    return () => {
      active = false;
    };
  }, [api, worktreePath]);

  const loadMore = useCallback(() => loadNextPage.current(), []);
  return { ...state, loadMore };
}
