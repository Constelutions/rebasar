import { useMemo, useState } from "react";

import type { ChangeKind, FileChange } from "../core/api";
import { Button } from "./Button";
import { type GroupTree, type TreeRow, fileKey, flattenChanges } from "./changeTree";
import { VirtualList } from "./VirtualList";

export const TREE_ROW_HEIGHT = 26;

export const statusLetters: Record<ChangeKind, { letter: string; label: string }> = {
  added: { letter: "A", label: "Added" },
  modified: { letter: "M", label: "Modified" },
  deleted: { letter: "D", label: "Deleted" },
  renamed: { letter: "R", label: "Renamed" },
  typeChanged: { letter: "T", label: "Type changed" },
  untracked: { letter: "U", label: "Untracked" },
  conflicted: { letter: "!", label: "Conflicted" },
};

export interface GroupAction {
  label: string;
  run: () => void;
}

export interface FileSelection<L extends string = string> {
  list: L;
  path: string;
}

export interface FileAction {
  label: string;
  /** Marks an action that can lose work. */
  destructive?: boolean;
  run: (change: FileChange) => void;
}

interface FileTreeProps<L extends string> {
  trees: GroupTree<L>[];
  selected: FileSelection<L> | null;
  onSelect: (list: L, change: FileChange) => void;
  /** The button that moves a file out of the given list, if the list has one. */
  actionsFor?: (list: L) => FileAction[];
  /** A button in the header of the list, such as 'Discard all'. */
  groupActionFor?: (list: L) => GroupAction | undefined;
}

export function FileTree<L extends string>({
  trees,
  selected,
  onSelect,
  actionsFor,
  groupActionFor,
}: FileTreeProps<L>) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const rows = useMemo(() => flattenChanges(trees, collapsed), [trees, collapsed]);

  function toggle(key: string) {
    setCollapsed((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }

  const selectedKey = selected && fileKey(selected.list, selected.path);

  return (
    <VirtualList
      label="Changed files"
      className="file-tree"
      items={rows}
      rowHeight={TREE_ROW_HEIGHT}
      getKey={(row) => row.key}
      renderRow={(row) => (
        <TreeRowView
          row={row}
          selected={row.type === "file" && row.key === selectedKey}
          onToggle={toggle}
          onSelect={onSelect}
          actions={row.type === "file" ? (actionsFor?.(row.list) ?? []) : []}
          groupAction={row.type === "group" ? groupActionFor?.(row.list) : undefined}
        />
      )}
    />
  );
}

interface TreeRowViewProps<L extends string> {
  row: TreeRow<L>;
  selected: boolean;
  onToggle: (key: string) => void;
  onSelect: (list: L, change: FileChange) => void;
  actions: FileAction[];
  groupAction: GroupAction | undefined;
}

function TreeRowView<L extends string>({
  row,
  selected,
  onToggle,
  onSelect,
  actions,
  groupAction,
}: TreeRowViewProps<L>) {
  const indent = { paddingLeft: `calc(var(--space-4) * ${"depth" in row ? row.depth : 0})` };

  if (row.type === "group") {
    return (
      <header className="change-group-header">
        <h2>{row.name}</h2>
        <span className="change-group-count">{row.count}</span>
        {groupAction && (
          <Button
            variant="plain"
            type="button"
            className="row-action danger group-action"
            onClick={groupAction.run}
          >
            {groupAction.label}
          </Button>
        )}
      </header>
    );
  }

  if (row.type === "folder") {
    return (
      <Button
        variant="plain"
        type="button"
        aria-expanded={row.expanded}
        className="tree-row folder-row"
        style={indent}
        onClick={() => onToggle(row.key)}
      >
        <span className="tree-name">{row.folder.name}</span>
        <LineCounts added={row.folder.added} removed={row.folder.removed} />
      </Button>
    );
  }

  const { kind, originalPath, added, removed } = row.file.change;
  return (
    <div className="file-row-wrap">
      <Button
        variant="plain"
        type="button"
        aria-current={selected || undefined}
        className="tree-row file-row"
        style={indent}
        onClick={() => onSelect(row.list, row.file.change)}
      >
        <span className={`status-letter status-${kind}`} title={statusLetters[kind].label}>
          {statusLetters[kind].letter}
        </span>
        <span className="tree-name">{row.file.name}</span>
        {originalPath && <span className="renamed-from">{originalPath}</span>}
        <LineCounts added={added} removed={removed} />
      </Button>
      {actions.map((action) => (
        <Button
          variant="plain"
          key={action.label}
          type="button"
          aria-label={`${action.label} ${row.file.change.path}`}
          className={action.destructive ? "row-action danger" : "row-action"}
          onClick={() => action.run(row.file.change)}
        >
          {action.label}
        </Button>
      ))}
    </div>
  );
}

export function LineCounts({ added, removed }: { added: number | null; removed: number | null }) {
  if (added === null || removed === null) return null;
  return (
    <span className="line-counts">
      <span className="count-added">+{added}</span>
      <span className="count-removed">−{removed}</span>
    </span>
  );
}
