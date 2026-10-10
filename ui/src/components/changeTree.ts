import type { FileChange } from "../core/api";

export interface FolderNode {
  type: "folder";
  name: string;
  path: string;
  children: TreeNode[];
  added: number;
  removed: number;
}

export interface FileNode {
  type: "file";
  name: string;
  change: FileChange;
}

export type TreeNode = FolderNode | FileNode;

/** `L` names a group of changes, such as `staged`, so the same tree serves other file lists. */
export interface ChangeGroup<L extends string = string> {
  list: L;
  name: string;
  changes: FileChange[];
}

export interface GroupTree<L extends string = string> {
  group: ChangeGroup<L>;
  nodes: TreeNode[];
}

export type TreeRow<L extends string = string> =
  | { type: "group"; key: string; name: string; count: number }
  | { type: "folder"; key: string; folder: FolderNode; depth: number; expanded: boolean }
  | { type: "file"; key: string; list: L; file: FileNode; depth: number };

const nameOrder = new Intl.Collator();

export function buildGroupTrees<L extends string>(groups: ChangeGroup<L>[]): GroupTree<L>[] {
  return groups.map((group) => ({ group, nodes: buildFileTree(group.changes) }));
}

export function buildFileTree(changes: FileChange[]): TreeNode[] {
  const root = newFolder("", "");
  const folders = new Map<string, FolderNode>();

  for (const change of changes) {
    const segments = change.path.split("/");
    const fileName = segments.pop() ?? change.path;
    let folder = root;
    for (const segment of segments) {
      folder = folderNamed(folders, folder, segment);
      folder.added += change.added ?? 0;
      folder.removed += change.removed ?? 0;
    }
    folder.children.push({ type: "file", name: fileName, change });
  }

  sortRecursively(root);
  return root.children;
}

export function folderKey(list: string, folderPath: string) {
  return `${list}:${folderPath}`;
}

export function fileKey(list: string, path: string) {
  return `${list}:${path}`;
}

/** The rows the tree shows, top to bottom, with the contents of collapsed folders left out. */
export function flattenChanges<L extends string>(
  trees: GroupTree<L>[],
  collapsed: ReadonlySet<string>,
): TreeRow<L>[] {
  const rows: TreeRow<L>[] = [];
  for (const { group, nodes } of trees) {
    rows.push({
      type: "group",
      key: `group:${group.list}`,
      name: group.name,
      count: group.changes.length,
    });
    appendNodes(rows, group.list, nodes, 0, collapsed);
  }
  return rows;
}

/** The file the tree lists first, which is the one shown when nothing was picked. */
export function firstFile<L extends string>(trees: GroupTree<L>[]) {
  for (const { group, nodes } of trees) {
    const file = firstFileOf(nodes);
    if (file) return { list: group.list, change: file.change };
  }
  return null;
}

function firstFileOf(nodes: TreeNode[]): FileNode | null {
  for (const node of nodes) {
    if (node.type === "file") return node;
    const nested = firstFileOf(node.children);
    if (nested) return nested;
  }
  return null;
}

function appendNodes<L extends string>(
  rows: TreeRow<L>[],
  list: L,
  nodes: TreeNode[],
  depth: number,
  collapsed: ReadonlySet<string>,
) {
  for (const node of nodes) {
    if (node.type === "file") {
      rows.push({ type: "file", key: fileKey(list, node.change.path), list, file: node, depth });
      continue;
    }
    const key = folderKey(list, node.path);
    const expanded = !collapsed.has(key);
    rows.push({ type: "folder", key, folder: node, depth, expanded });
    if (expanded) appendNodes(rows, list, node.children, depth + 1, collapsed);
  }
}

function newFolder(name: string, path: string): FolderNode {
  return { type: "folder", name, path, children: [], added: 0, removed: 0 };
}

function folderNamed(
  folders: Map<string, FolderNode>,
  parent: FolderNode,
  name: string,
): FolderNode {
  const path = parent.path ? `${parent.path}/${name}` : name;
  const existing = folders.get(path);
  if (existing) return existing;

  const created = newFolder(name, path);
  folders.set(path, created);
  parent.children.push(created);
  return created;
}

function sortRecursively(folder: FolderNode) {
  folder.children.sort((a, b) => {
    if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
    return nameOrder.compare(a.name, b.name);
  });
  for (const child of folder.children) {
    if (child.type === "folder") sortRecursively(child);
  }
}
