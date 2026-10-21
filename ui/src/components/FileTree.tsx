import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ChangeKind, Editor, FileChange, FilesView } from "../core/api";
import { useDismiss } from "../useDismiss";
import { type FileOpener, NOTHING_TO_OPEN, canOpen } from "../useEditors";
import { Button } from "./Button";
import { type GroupTree, type TreeRow, fileKey, flattenChanges } from "./changeTree";
import { SegmentedControl } from "./SegmentedControl";
import { VirtualList } from "./VirtualList";

const viewOptions = [
  { value: "tree", label: "Tree" },
  { value: "flat", label: "Flat" },
] as const;

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
  view?: FilesView;
  /** Puts a tree/flat toggle in the header of every list that `viewToggleFor` accepts. */
  onViewChange?: (view: FilesView) => void;
  viewToggleFor?: (list: L) => boolean;
  /** Adds "Open file in…" to every file row. */
  fileOpener?: FileOpener;
}

interface OpenMenu {
  change: FileChange;
  anchor: DOMRect;
}

export function FileTree<L extends string>({
  trees,
  selected,
  onSelect,
  actionsFor,
  groupActionFor,
  view = "tree",
  onViewChange,
  viewToggleFor = () => true,
  fileOpener,
}: FileTreeProps<L>) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [openMenu, setOpenMenu] = useState<OpenMenu | null>(null);
  const closeMenu = useCallback(() => setOpenMenu(null), []);
  const rows = useMemo(() => flattenChanges(trees, collapsed, view), [trees, collapsed, view]);

  function toggle(key: string) {
    setCollapsed((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }

  const selectedKey = selected && fileKey(selected.list, selected.path);

  return (
    <>
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
            onOpenIn={fileOpener && setOpenMenu}
            groupAction={row.type === "group" ? groupActionFor?.(row.list) : undefined}
            viewToggle={
              row.type === "group" && onViewChange && viewToggleFor(row.list)
                ? { view, onChange: onViewChange }
                : undefined
            }
          />
        )}
      />
      {fileOpener && openMenu && (
        <FileEditorMenu
          opener={fileOpener}
          menu={openMenu}
          onPick={(editor) => {
            closeMenu();
            fileOpener.open(editor, openMenu.change);
          }}
          onClose={closeMenu}
        />
      )}
    </>
  );
}

interface FileEditorMenuProps {
  opener: FileOpener;
  menu: OpenMenu;
  onPick: (editor: Editor) => void;
  onClose: () => void;
}

/** Fixed to the viewport because the list scrolls and would clip a menu inside it. */
function FileEditorMenu({ opener, menu, onPick, onClose }: FileEditorMenuProps) {
  const container = useRef<HTMLDivElement>(null);
  useDismiss(true, container, onClose);

  useEffect(() => {
    const items = [...(container.current?.querySelectorAll<HTMLElement>("button:not(:disabled)") ?? [])];
    (items.find((item) => item.getAttribute("aria-current") === "true") ?? items[0])?.focus();
  }, []);

  return (
    <div
      ref={container}
      role="menu"
      aria-label="Open file in"
      className="file-editor-menu"
      style={{ top: menu.anchor.bottom, right: window.innerWidth - menu.anchor.right }}
    >
      {opener.editors.map((editor) => (
        <Button
          variant="plain"
          key={editor.id}
          role="menuitem"
          aria-current={editor.id === opener.lastUsed || undefined}
          disabled={!editor.available}
          title={editor.unavailableReason ?? undefined}
          onClick={() => onPick(editor)}
        >
          {editor.label}
        </Button>
      ))}
    </div>
  );
}

interface TreeRowViewProps<L extends string> {
  row: TreeRow<L>;
  selected: boolean;
  onToggle: (key: string) => void;
  onSelect: (list: L, change: FileChange) => void;
  actions: FileAction[];
  /** Present when the rows offer "Open file in…"; called with the file and where its button is. */
  onOpenIn: ((menu: OpenMenu) => void) | undefined;
  groupAction: GroupAction | undefined;
  viewToggle: { view: FilesView; onChange: (view: FilesView) => void } | undefined;
}

function TreeRowView<L extends string>({
  row,
  selected,
  onToggle,
  onSelect,
  actions,
  onOpenIn,
  groupAction,
  viewToggle,
}: TreeRowViewProps<L>) {
  const indent = { paddingLeft: `calc(var(--space-4) * ${"depth" in row ? row.depth : 0})` };

  if (row.type === "group") {
    return (
      <header className="change-group-header">
        <h2>{row.name}</h2>
        <span className="change-group-count">{row.count}</span>
        {viewToggle && (
          <SegmentedControl
            label={`${row.name} view`}
            options={viewOptions}
            value={viewToggle.view}
            onChange={viewToggle.onChange}
          />
        )}
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
        {row.directory && <span className="tree-directory">{row.directory}</span>}
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
      {onOpenIn && (
        <Button
          variant="plain"
          type="button"
          aria-label={`Open file in… ${row.file.change.path}`}
          aria-haspopup="menu"
          className="row-action"
          disabled={!canOpen(row.file.change)}
          title={canOpen(row.file.change) ? "Open file in…" : NOTHING_TO_OPEN}
          onClick={(event) =>
            onOpenIn({ change: row.file.change, anchor: event.currentTarget.getBoundingClientRect() })
          }
        >
          Open in…
        </Button>
      )}
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
