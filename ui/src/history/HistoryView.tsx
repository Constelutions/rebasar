import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";

import type { CoreApi, HistoryRow, Tab } from "../core/api";
import { Avatar } from "./Avatar";
import { CommitGraph, DayGraph } from "./CommitGraph";
import { RefBadge } from "./RefBadge";
import { ROW_HEIGHT, graphWidth } from "./geometry";
import { type HistoryItem, formatTime } from "./items";
import { useHistory } from "./useHistory";

const OVERSCAN_ROWS = 4;
/** Ask for the next page this many rows before the end is reached, so scrolling never waits. */
const PREFETCH_ROWS = 40;
/** Used until the real height is measured, and wherever layout is not computed. */
const FALLBACK_VIEWPORT = 600;

export function HistoryView({ api, tab }: { api: CoreApi; tab: Tab }) {
  const { items, laneCount, loaded, error, loadMore } = useHistory(api, tab.worktreePath);
  const scroller = useRef<HTMLDivElement>(null);
  const [firstVisibleRow, setFirstVisibleRow] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(FALLBACK_VIEWPORT);

  useLayoutEffect(() => {
    const measure = () =>
      setViewportHeight(scroller.current?.clientHeight || FALLBACK_VIEWPORT);
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  const first = Math.max(0, firstVisibleRow - OVERSCAN_ROWS);
  const last = Math.min(
    items.length,
    firstVisibleRow + Math.ceil(viewportHeight / ROW_HEIGHT) + OVERSCAN_ROWS,
  );

  useEffect(() => {
    if (last >= items.length - PREFETCH_ROWS) loadMore();
  }, [last, items.length, loadMore]);

  if (error !== null) {
    return (
      <p role="alert" className="error">
        {error}
      </p>
    );
  }
  if (loaded && items.length === 0) {
    return <p className="placeholder">No commits yet.</p>;
  }

  return (
    <div
      ref={scroller}
      className="history-scroller"
      onScroll={(event) =>
        setFirstVisibleRow(Math.floor(event.currentTarget.scrollTop / ROW_HEIGHT))
      }
    >
      <div
        role="list"
        aria-label="Commit history"
        className="history-list"
        style={{ height: items.length * ROW_HEIGHT }}
      >
        {items.slice(first, last).map((item, offset) => (
          <HistoryItemView key={itemKey(item)} item={item} index={first + offset} laneCount={laneCount} />
        ))}
      </div>
    </div>
  );
}

function itemKey(item: HistoryItem): string {
  return item.kind === "day" ? item.key : item.row.id;
}

interface HistoryItemViewProps {
  item: HistoryItem;
  index: number;
  laneCount: number;
}

const HistoryItemView = memo(function HistoryItemView({ item, index, laneCount }: HistoryItemViewProps) {
  const position = { top: index * ROW_HEIGHT, height: ROW_HEIGHT };
  if (item.kind === "day") {
    return (
      <div role="presentation" className="history-item day" style={position}>
        <DayGraph lanes={item.lanes} laneCount={laneCount} />
        <h2 className="day-heading">{item.label}</h2>
      </div>
    );
  }
  return <CommitItem row={item.row} laneCount={laneCount} style={position} />;
});

function CommitItem({
  row,
  laneCount,
  style,
}: {
  row: HistoryRow;
  laneCount: number;
  style: { top: number; height: number };
}) {
  return (
    <div role="listitem" className="history-item commit" style={style}>
      <CommitGraph row={row} laneCount={laneCount} />
      <Avatar name={row.authorName} email={row.authorEmail} />
      <span className="commit-message">
        <span className="commit-subject">{row.subject}</span>
        {row.refs.map((label) => (
          <RefBadge key={`${label.kind}-${label.name}`} label={label} />
        ))}
      </span>
      <span className="commit-author">{row.authorName}</span>
      <span className="commit-hash">{row.shortId}</span>
      <time className="commit-time" dateTime={new Date(row.timestamp * 1000).toISOString()}>
        {formatTime(row.timestamp)}
      </time>
    </div>
  );
}
