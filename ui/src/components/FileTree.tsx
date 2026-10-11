import { useMemo, useState } from "react";

import type { ChangeKind, FileChange } from "../core/api";
import { type GroupTree, type TreeRow, fileKey, flattenChanges } from "./changeTree";
import { VirtualList } from "./VirtualList";

export const TREE_ROW_HEIGHT = 26;

const statusLetters: Record<ChangeKind, { letter: string; label: string }> = {
  added: { letter: "A", label: "Added" },
  modified: { letter: "M", label: "Modified" },
  deleted: { letter: "D", label: "Deleted" },
  renamed: { letter: "R", label: "Renamed" },
  typeChanged: { letter: "T", label: "Type changed" },
  untracked: { letter: "U", label: "Untracked" },
  conflicted: { letter: "!", label: "Conflicted" },
};

export interface FileSelection<L extends string = string> {
  list: L;
  path: string;
}

export interface FileAction {
  label: string;
  run: (change: FileChange) => void;
}

interface FileTreeProps<L extends string> {
  trees: GroupTree<L>[];
  selected: FileSelection<L> | null;
  onSelect: (list: L, change: FileChange) => void;
  /** The button that moves a file out of the given list, if the list has one. */
  actionFor?: (list: L) => FileAction | undefined;
}

export function FileTree<L extends string>({
  trees,
  selected,
  onSelect,
  actionFor,
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
          action={row.type === "file" ? actionFor?.(row.list) : undefined}
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
  action: FileAction | undefined;
}

function TreeRowView<L extends string>({
  row,
  selected,
  onToggle,
  onSelect,
  action,
}: TreeRowViewProps<L>) {
  const indent = { paddingLeft: `calc(var(--space-4) * ${"depth" in row ? row.depth : 0})` };

  if (row.type === "group") {
    return (
      <header className="change-group-header">
        <h2>{row.name}</h2>
        <span className="change-group-count">{row.count}</span>
      </header>
    );
  }

  if (row.type === "folder") {
    return (
      <button
        type="button"
        aria-expanded={row.expanded}
        className="tree-row folder-row"
        style={indent}
        onClick={() => onToggle(row.key)}
      >
        <span className="tree-name">{row.folder.name}</span>
        <LineCounts added={row.folder.added} removed={row.folder.removed} />
      </button>
    );
  }

  const { kind, originalPath, added, removed } = row.file.change;
  return (
    <div className="file-row-wrap">
      <button
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
      </button>
      {action && (
        <button
          type="button"
          aria-label={`${action.label} ${row.file.change.path}`}
          className="row-action"
          onClick={() => action.run(row.file.change)}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}

function LineCounts({ added, removed }: { added: number | null; removed: number | null }) {
  if (added === null || removed === null) return null;
  return (
    <span className="line-counts">
      <span className="count-added">+{added}</span>
      <span className="count-removed">−{removed}</span>
    </span>
  );
}
