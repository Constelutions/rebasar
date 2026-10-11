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

export function buildFileTree(changes: FileChange[]): TreeNode[] {
  const root = newFolder("", "");

  for (const change of changes) {
    const segments = change.path.split("/");
    const fileName = segments.pop() ?? change.path;
    let folder = root;
    for (const segment of segments) {
      folder = folderNamed(folder, segment);
      folder.added += change.added ?? 0;
      folder.removed += change.removed ?? 0;
    }
    folder.children.push({ type: "file", name: fileName, change });
  }

  sortRecursively(root);
  return root.children;
}

function newFolder(name: string, path: string): FolderNode {
  return { type: "folder", name, path, children: [], added: 0, removed: 0 };
}

function folderNamed(parent: FolderNode, name: string): FolderNode {
  const existing = parent.children.find(
    (child): child is FolderNode => child.type === "folder" && child.name === name,
  );
  if (existing) return existing;

  const created = newFolder(name, parent.path ? `${parent.path}/${name}` : name);
  parent.children.push(created);
  return created;
}

function sortRecursively(folder: FolderNode) {
  folder.children.sort((a, b) => {
    if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  for (const child of folder.children) {
    if (child.type === "folder") sortRecursively(child);
  }
}
