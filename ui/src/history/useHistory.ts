import { useCallback, useEffect, useRef, useState } from "react";

import { type CoreApi, type HistoryCount, type HistoryFilter, type HistoryPage, isApiError } from "../core/api";
import { describeError } from "../core/describeError";
import { type HistoryItem, appendRows } from "./items";

export const PAGE_SIZE = 100;

interface HistoryState {
  items: HistoryItem[];
  laneCount: number;
  loaded: boolean;
  hasMore: boolean;
  error: string | null;
  /** Why the query was refused; the rows of the last good filter stay on show meanwhile. */
  queryError: string | null;
  /** Counts the times the rows were replaced by those of another filter. */
  generation: number;
}

const empty: HistoryState = {
  items: [],
  laneCount: 1,
  loaded: false,
  hasMore: true,
  error: null,
  queryError: null,
  generation: 0,
};

function withPage(state: HistoryState, page: HistoryPage, replace: boolean): HistoryState {
  const base = replace ? { ...empty, generation: state.generation + 1 } : state;
  return {
    ...base,
    items: appendRows(base.items, page.rows),
    laneCount: page.rows.reduce((widest, row) => Math.max(widest, row.laneCount), base.laneCount),
    loaded: true,
    hasMore: page.hasMore,
    error: null,
    queryError: null,
  };
}

/**
 * Loads a Worktree's history one page at a time; `loadMore` fetches the next page. When `filter`
 * changes, the rows on show are kept until the first page of the new filter arrives.
 */
export function useHistory(api: CoreApi, worktreePath: string, filter: HistoryFilter) {
  const [state, setState] = useState<HistoryState>(empty);
  const loadNextPage = useRef<() => void>(() => {});

  useEffect(() => {
    let active = true;
    let loadedRows = 0;
    let hasMore = true;
    let loading = false;
    let replacing = true;

    loadNextPage.current = () => {
      if (!active || loading || !hasMore) return;
      loading = true;
      api.historyPage(worktreePath, loadedRows, PAGE_SIZE, filter).then(
        (page) => {
          loading = false;
          if (!active) return;
          const replace = replacing;
          replacing = false;
          loadedRows += page.rows.length;
          hasMore = page.hasMore;
          setState((current) => withPage(current, page, replace));
        },
        (failure) => {
          loading = false;
          if (!active) return;
          hasMore = false;
          const message = describeError(failure);
          setState((current) =>
            isApiError(failure) && failure.kind === "invalidQuery"
              ? { ...current, loaded: true, hasMore: false, queryError: message }
              : { ...current, loaded: true, hasMore: false, error: message },
          );
        },
      );
    };
    loadNextPage.current();

    return () => {
      active = false;
    };
  }, [api, worktreePath, filter]);

  const loadMore = useCallback(() => loadNextPage.current(), []);
  return { ...state, loadMore };
}

/** How many commits `filter` lets through; stays at the previous count until the new one is known. */
export function useHistoryCount(
  api: CoreApi,
  worktreePath: string,
  filter: HistoryFilter,
): HistoryCount | null {
  const [count, setCount] = useState<HistoryCount | null>(null);

  useEffect(() => {
    let active = true;
    api.historyCount(worktreePath, filter).then(
      (counted) => {
        if (active) setCount(counted);
      },
      () => {
        // The page request reports the failure; the count has nothing more to add.
      },
    );
    return () => {
      active = false;
    };
  }, [api, worktreePath, filter]);

  return count;
}
