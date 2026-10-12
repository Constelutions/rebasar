import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { SegmentedControl } from "../components/SegmentedControl";
import type { CoreApi, HistoryRow, Tab } from "../core/api";
import { describeError } from "../core/describeError";
import { useDebounced } from "../useDebounced";
import { Avatar } from "./Avatar";
import { RebaseEditor } from "../components/RebaseEditor";
import { CommitActionDialog, type CommitDialog } from "./CommitActionDialog";
import { CommitDetailPane } from "./CommitDetailPane";
import { type CommitAction, CommitMenu } from "./CommitMenu";
import { type Connections, CommitGraph, DayGraph } from "./CommitGraph";
import { type Chips, FilterBar } from "./FilterBar";
import { defaultChips, useHistoryCommands } from "./historyCommands";
import { RefBadge } from "./RefBadge";
import { type GraphStyle, type Orientation, itemSize } from "./geometry";
import { type HistoryItem, formatTime } from "./items";
import { useHistory, useHistoryCount } from "./useHistory";
import { useHistoryLayout } from "./useHistoryLayout";

const OVERSCAN_ITEMS = 4;
/** Ask for the next page this many items before the end is reached, so scrolling never waits. */
const PREFETCH_ITEMS = 40;
/** Used until the real size is measured, and wherever layout is not computed. */
const FALLBACK_VIEWPORT = 600;
/** Typing is applied once it pauses, so each keystroke does not walk the whole history. */
const QUERY_DEBOUNCE_MS = 250;

const orientations = [
  { value: "vertical", label: "Vertical" },
  { value: "horizontal", label: "Horizontal" },
] as const;

const graphStyles = [
  { value: "tree", label: "Tree" },
  { value: "linear", label: "Linear" },
] as const;

interface HistoryViewProps {
  api: CoreApi;
  tab: Tab;
  initialQuery?: string;
}

export function HistoryView({ api, tab, initialQuery = "" }: HistoryViewProps) {
  const [queryText, setQueryText] = useState(initialQuery);
  const [chips, setChips] = useState<Chips>(defaultChips);
  useHistoryCommands({ queryText, setQueryText, chips, setChips });
  const query = useDebounced(queryText, QUERY_DEBOUNCE_MS);
  const filter = useMemo(() => ({ query, ...chips }), [query, chips]);
  const { items, laneCount, loaded, hasMore, error, queryError, generation, loadMore } = useHistory(
    api,
    tab.worktreePath,
    filter,
  );
  const count = useHistoryCount(api, tab.worktreePath, filter);
  const [{ orientation, style }, changeLayout] = useHistoryLayout();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [comparing, setComparing] = useState(false);
  const [menu, setMenu] = useState<{ commitId: string; x: number; y: number } | null>(null);
  const [dialog, setDialog] = useState<{ kind: CommitDialog; commitId: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [rebaseFrom, setRebaseFrom] = useState<string | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);

  function commitOf(commitId: string): HistoryRow | undefined {
    return items.flatMap((item) => (item.kind === "commit" ? [item.row] : [])).find((row) => row.id === commitId);
  }

  function select(commitId: string) {
    setComparing(false);
    setSelectedId(commitId);
  }

  async function runAction(action: CommitAction, commitId: string) {
    setMenu(null);
    setNotice(null);
    const shortId = commitOf(commitId)?.shortId ?? commitId.slice(0, 7);
    switch (action) {
      case "checkout": {
        const outcome = await api.checkoutCommit(tab.worktreePath, commitId).catch((failure) => {
          setNotice(describeError(failure));
          return null;
        });
        if (outcome?.kind === "failed") setNotice(`Check out ${shortId} failed. Details are in the output panel.`);
        return;
      }
      case "createBranch":
        return setDialog({ kind: "branch", commitId });
      case "createTag":
        return setDialog({ kind: "tag", commitId });
      case "reword":
        return setDialog({ kind: "reword", commitId });
      case "copyHash":
        return navigator.clipboard.writeText(commitId).catch((failure) => setNotice(describeError(failure)));
      case "rebase":
        return setRebaseFrom(commitId);
      case "compare":
        setSelectedId(commitId);
        return setComparing(true);
    }
  }

  const filterBar = (
    <FilterBar
      query={queryText}
      onQueryChange={setQueryText}
      chips={chips}
      onChipsChange={setChips}
      count={count}
      queryError={queryError}
    />
  );

  if (error !== null) {
    return (
      <>
        {filterBar}
        <p role="alert" className="error">
          {error}
        </p>
      </>
    );
  }
  if (loaded && items.length === 0) {
    const filtered = filter.query !== "" || filter.mine || filter.merges || !filter.allBranches;
    return (
      <>
        {filterBar}
        <p className="placeholder">{filtered ? "No commits match this filter." : "No commits yet."}</p>
      </>
    );
  }

  return (
    <>
      {filterBar}
      <div className="history-toolbar">
        <SegmentedControl
          label="Orientation"
          options={orientations}
          value={orientation}
          onChange={(value) => changeLayout({ orientation: value })}
        />
        <SegmentedControl
          label="Graph style"
          options={graphStyles}
          value={style}
          onChange={(value) => changeLayout({ style: value })}
        />
      </div>
      <div className="history" data-detail-open={selectedId !== null || undefined}>
        <HistoryList
          key={`${orientation}-${generation}`}
          items={items}
          laneCount={laneCount}
          hasMore={hasMore}
          orientation={orientation}
          style={style}
          loadMore={loadMore}
          selectedId={selectedId}
          onSelect={select}
          onOpenMenu={(commitId, x, y) => setMenu({ commitId, x, y })}
        />
        {selectedId !== null && (
          <CommitDetailPane
            key={selectedId}
            api={api}
            worktreePath={tab.worktreePath}
            commitId={selectedId}
            comparing={comparing}
            onComparingChange={setComparing}
            onClose={() => setSelectedId(null)}
          />
        )}
      </div>
      {notice && (
        <p role="alert" className="error">
          {notice}
        </p>
      )}
      {menu && (
        <CommitMenu
          x={menu.x}
          y={menu.y}
          onSelect={(action) => void runAction(action, menu.commitId)}
          onClose={closeMenu}
        />
      )}
      {dialog && (
        <CommitActionDialog
          api={api}
          worktreePath={tab.worktreePath}
          kind={dialog.kind}
          commitId={dialog.commitId}
          shortId={commitOf(dialog.commitId)?.shortId ?? dialog.commitId.slice(0, 7)}
          isLatest={commitOf(dialog.commitId)?.refs.some((label) => label.kind === "head") ?? false}
          onClose={() => setDialog(null)}
          onOpenRebaseEditor={() => {
            setRebaseFrom(dialog.commitId);
            setDialog(null);
          }}
        />
      )}
      {rebaseFrom && (
        <RebaseEditor
          api={api}
          worktreePath={tab.worktreePath}
          from={rebaseFrom}
          onClose={() => setRebaseFrom(null)}
        />
      )}
    </>
  );
}

interface HistoryListProps {
  items: HistoryItem[];
  laneCount: number;
  hasMore: boolean;
  orientation: Orientation;
  style: GraphStyle;
  loadMore: () => void;
  selectedId: string | null;
  onSelect: (commitId: string) => void;
  onOpenMenu: (commitId: string, x: number, y: number) => void;
}

function HistoryList({
  items,
  laneCount,
  hasMore,
  orientation,
  style,
  loadMore,
  selectedId,
  onSelect,
  onOpenMenu,
}: HistoryListProps) {
  const size = itemSize(orientation);
  const horizontal = orientation === "horizontal";
  const scroller = useRef<HTMLDivElement>(null);
  const [firstVisible, setFirstVisible] = useState(0);
  const [viewportSize, setViewportSize] = useState(FALLBACK_VIEWPORT);

  useLayoutEffect(() => {
    const measure = () => {
      const element = scroller.current;
      setViewportSize((horizontal ? element?.clientWidth : element?.clientHeight) || FALLBACK_VIEWPORT);
    };
    measure();
    window.addEventListener("resize", measure);
    // Opening the detail pane shrinks the list without resizing the window.
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    if (scroller.current) observer?.observe(scroller.current);
    return () => {
      window.removeEventListener("resize", measure);
      observer?.disconnect();
    };
  }, [horizontal]);

  const first = Math.max(0, firstVisible - OVERSCAN_ITEMS);
  const last = Math.min(items.length, firstVisible + Math.ceil(viewportSize / size) + OVERSCAN_ITEMS);

  useEffect(() => {
    if (last >= items.length - PREFETCH_ITEMS) loadMore();
  }, [last, items.length, loadMore]);

  return (
    <div
      ref={scroller}
      className="history-scroller"
      data-orientation={orientation}
      onScroll={({ currentTarget }) =>
        setFirstVisible(Math.floor((horizontal ? currentTarget.scrollLeft : currentTarget.scrollTop) / size))
      }
    >
      <div
        role="list"
        aria-label="Commit history"
        className="history-list"
        data-orientation={orientation}
        style={horizontal ? { width: items.length * size } : { height: items.length * size }}
      >
        {items.slice(first, last).map((item, offset) => {
          const index = first + offset;
          return (
            <HistoryItemView
              key={itemKey(item)}
              item={item}
              index={index}
              connectedAbove={connectedAbove(items, index)}
              connectedBelow={index < items.length - 1 || hasMore}
              laneCount={laneCount}
              orientation={orientation}
              style={style}
              selectedId={selectedId}
              onSelect={onSelect}
              onOpenMenu={onOpenMenu}
            />
          );
        })}
      </div>
    </div>
  );
}

function itemKey(item: HistoryItem): string {
  return item.kind === "day" ? item.key : item.row.id;
}

/** A linear graph runs unbroken from the newest commit to the oldest, heading rows included. */
function connectedAbove(items: HistoryItem[], index: number): boolean {
  const previous = items[index - 1];
  return previous !== undefined && !(previous.kind === "day" && previous.lanes.length === 0);
}

interface HistoryItemViewProps {
  item: HistoryItem;
  index: number;
  connectedAbove: boolean;
  connectedBelow: boolean;
  laneCount: number;
  orientation: Orientation;
  style: GraphStyle;
  selectedId: string | null;
  onSelect: (commitId: string) => void;
  onOpenMenu: (commitId: string, x: number, y: number) => void;
}

const HistoryItemView = memo(function HistoryItemView({
  item,
  index,
  connectedAbove,
  connectedBelow,
  laneCount,
  orientation,
  style,
  selectedId,
  onSelect,
  onOpenMenu,
}: HistoryItemViewProps) {
  const size = itemSize(orientation);
  const position =
    orientation === "vertical" ? { top: index * size, height: size } : { left: index * size, width: size };
  const graph = { orientation, style, laneCount };

  if (item.kind === "day") {
    return (
      <div role="presentation" className="history-item day" style={position}>
        <DayGraph lanes={item.lanes} {...graph} />
        <h2 className="day-heading">{item.label}</h2>
      </div>
    );
  }
  return (
    <CommitItem
      row={item.row}
      connections={{ above: connectedAbove, below: connectedBelow }}
      graph={graph}
      style={position}
      selected={item.row.id === selectedId}
      onSelect={onSelect}
      onOpenMenu={onOpenMenu}
    />
  );
});

interface CommitItemProps {
  row: HistoryRow;
  connections: Connections;
  graph: { orientation: Orientation; style: GraphStyle; laneCount: number };
  style: { top: number; height: number } | { left: number; width: number };
  selected: boolean;
  onSelect: (commitId: string) => void;
  onOpenMenu: (commitId: string, x: number, y: number) => void;
}

function CommitItem({ row, connections, graph, style, selected, onSelect, onOpenMenu }: CommitItemProps) {
  return (
    <div
      role="listitem"
      tabIndex={0}
      aria-current={selected || undefined}
      className="history-item commit"
      style={style}
      onClick={() => onSelect(row.id)}
      onContextMenu={(event) => {
        event.preventDefault();
        onOpenMenu(row.id, event.clientX, event.clientY);
      }}
      onKeyDown={(event) => {
        if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
          event.preventDefault();
          const box = event.currentTarget.getBoundingClientRect();
          onOpenMenu(row.id, box.left, box.bottom);
          return;
        }
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        onSelect(row.id);
      }}
    >
      <CommitGraph row={row} connections={connections} {...graph} />
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
