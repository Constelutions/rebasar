import { useCallback, useMemo, useState } from "react";

import type { ChangeKind, FileChange, FilesView } from "../core/api";
import { type FileOpener, NOTHING_TO_OPEN, canOpen } from "../useEditors";
import { ActionMenu, type MenuItem, OptionsButton } from "./ActionMenu";
import { Button } from "./Button";
import { ChevronIcon } from "./ChevronIcon";
import { type GroupTree, type TreeRow, fileKey, flattenChanges } from "./changeTree";
import { SegmentedControl } from "./SegmentedControl";
import { TruncatedText } from "./TruncatedText";
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
  /** What can be done to a file of the given list: the first stays on the row, the rest go in its menu. */
  actionsFor?: (list: L) => FileAction[];
  /** An item in the menu of the header of the list, such as 'Discard all'. */
  groupActionFor?: (list: L) => GroupAction | undefined;
  view?: FilesView;
  /** Puts a tree/flat toggle in the header of every list that `viewToggleFor` accepts. */
  onViewChange?: (view: FilesView) => void;
  viewToggleFor?: (list: L) => boolean;
  /** Adds "Open in…" to the menu of every file row. */
  fileOpener?: FileOpener;
}

export interface OpenRowMenu {
  label: string;
  items: MenuItem[];
  x: number;
  y: number;
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
  const [openMenu, setOpenMenu] = useState<OpenRowMenu | null>(null);
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
            fileOpener={fileOpener}
            onOpenMenu={setOpenMenu}
            groupAction={row.type === "group" ? groupActionFor?.(row.list) : undefined}
            viewToggle={
              row.type === "group" && onViewChange && viewToggleFor(row.list)
                ? { view, onChange: onViewChange }
                : undefined
            }
          />
        )}
      />
      {openMenu && (
        <ActionMenu
          label={openMenu.label}
          items={openMenu.items}
          x={openMenu.x}
          y={openMenu.y}
          onClose={closeMenu}
        />
      )}
    </>
  );
}

interface TreeRowViewProps<L extends string> {
  row: TreeRow<L>;
  selected: boolean;
  onToggle: (key: string) => void;
  onSelect: (list: L, change: FileChange) => void;
  actions: FileAction[];
  fileOpener: FileOpener | undefined;
  onOpenMenu: (menu: OpenRowMenu) => void;
  groupAction: GroupAction | undefined;
  viewToggle: { view: FilesView; onChange: (view: FilesView) => void } | undefined;
}

function menuItemsFor(change: FileChange, secondary: FileAction[], opener: FileOpener | undefined): MenuItem[] {
  const items: MenuItem[] = secondary.map((action) => ({
    key: action.label,
    label: action.label,
    destructive: action.destructive,
    run: () => action.run(change),
  }));
  if (opener) {
    items.push({
      key: "open-in",
      label: "Open in…",
      separated: items.length > 0,
      disabled: !canOpen(change),
      title: canOpen(change) ? undefined : NOTHING_TO_OPEN,
      submenu: opener.editors.map((editor) => ({
        key: editor.id,
        label: editor.label,
        current: editor.id === opener.lastUsed,
        disabled: !editor.available,
        title: editor.unavailableReason ?? undefined,
        run: () => opener.open(editor, change),
      })),
    });
  }
  return items;
}

function TreeRowView<L extends string>({
  row,
  selected,
  onToggle,
  onSelect,
  actions,
  fileOpener,
  onOpenMenu,
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
          <OptionsButton
            label={`${row.name} options`}
            expanded={false}
            onClick={(event) => {
              const box = event.currentTarget.getBoundingClientRect();
              onOpenMenu({
                label: `${row.name} actions`,
                items: [{ key: groupAction.label, label: groupAction.label, destructive: true, run: groupAction.run }],
                x: box.left,
                y: box.bottom,
              });
            }}
          />
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
        <ChevronIcon direction={row.expanded ? "down" : "right"} />
        <TruncatedText className="tree-name" text={row.folder.name} />
        <LineCounts added={row.folder.added} removed={row.folder.removed} />
      </Button>
    );
  }

  const change = row.file.change;
  const { kind, originalPath, added, removed } = change;
  const [primary, ...secondary] = actions;
  const items = menuItemsFor(change, secondary, fileOpener);
  const menuLabel = `Actions for ${change.path}`;

  return (
    <div
      className="file-row-wrap"
      onContextMenu={
        items.length > 0
          ? (event) => {
              event.preventDefault();
              onOpenMenu({ label: menuLabel, items, x: event.clientX, y: event.clientY });
            }
          : undefined
      }
    >
      <Button
        variant="plain"
        type="button"
        aria-current={selected || undefined}
        className="tree-row file-row"
        style={indent}
        onClick={() => onSelect(row.list, change)}
      >
        <span className={`status-letter status-${kind}`} title={statusLetters[kind].label}>
          {statusLetters[kind].letter}
        </span>
        <TruncatedText className="tree-name" text={row.file.name} />
        {row.directory && <TruncatedText className="tree-directory" text={row.directory} />}
        {originalPath && <TruncatedText className="renamed-from" text={originalPath} />}
        <LineCounts added={added} removed={removed} />
      </Button>
      {primary && (
        <Button
          variant="plain"
          type="button"
          aria-label={`${primary.label} ${change.path}`}
          className={primary.destructive ? "row-action danger" : "row-action"}
          onClick={() => primary.run(change)}
        >
          {primary.label}
        </Button>
      )}
      {items.length > 0 && (
        <OptionsButton
          label={`Options for ${change.path}`}
          expanded={false}
          onClick={(event) => {
            const box = event.currentTarget.getBoundingClientRect();
            onOpenMenu({ label: menuLabel, items, x: box.left, y: box.bottom });
          }}
        />
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
