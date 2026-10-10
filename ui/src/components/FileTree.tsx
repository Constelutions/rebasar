import { useState } from "react";

import type { ChangeKind, FileChange } from "../core/api";
import { type FileNode, type FolderNode, type TreeNode, buildFileTree } from "./changeTree";

const statusLetters: Record<ChangeKind, { letter: string; label: string }> = {
  added: { letter: "A", label: "Added" },
  modified: { letter: "M", label: "Modified" },
  deleted: { letter: "D", label: "Deleted" },
  renamed: { letter: "R", label: "Renamed" },
  typeChanged: { letter: "T", label: "Type changed" },
  untracked: { letter: "U", label: "Untracked" },
  conflicted: { letter: "!", label: "Conflicted" },
};

export function FileTree({ changes }: { changes: FileChange[] }) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());

  function toggle(path: string) {
    setCollapsed((current) => {
      const next = new Set(current);
      if (!next.delete(path)) next.add(path);
      return next;
    });
  }

  return <TreeLevel nodes={buildFileTree(changes)} collapsed={collapsed} onToggle={toggle} />;
}

interface TreeLevelProps {
  nodes: TreeNode[];
  collapsed: ReadonlySet<string>;
  onToggle: (path: string) => void;
}

function TreeLevel({ nodes, collapsed, onToggle }: TreeLevelProps) {
  return (
    <ul className="file-tree">
      {nodes.map((node) =>
        node.type === "folder" ? (
          <FolderRow key={node.path} folder={node} collapsed={collapsed} onToggle={onToggle} />
        ) : (
          <FileRow key={node.change.path} file={node} />
        ),
      )}
    </ul>
  );
}

function FileRow({ file }: { file: FileNode }) {
  const { kind, originalPath, added, removed } = file.change;
  return (
    <li>
      <div className="tree-row">
        <span className={`status-letter status-${kind}`} title={statusLetters[kind].label}>
          {statusLetters[kind].letter}
        </span>
        <span className="tree-name">{file.name}</span>
        {originalPath && <span className="renamed-from">{originalPath}</span>}
        <LineCounts added={added} removed={removed} />
      </div>
    </li>
  );
}

interface FolderRowProps {
  folder: FolderNode;
  collapsed: ReadonlySet<string>;
  onToggle: (path: string) => void;
}

function FolderRow({ folder, collapsed, onToggle }: FolderRowProps) {
  const expanded = !collapsed.has(folder.path);
  return (
    <li>
      <button
        type="button"
        aria-expanded={expanded}
        className="tree-row folder-row"
        onClick={() => onToggle(folder.path)}
      >
        <span className="tree-name">{folder.name}</span>
        <LineCounts added={folder.added} removed={folder.removed} />
      </button>
      {expanded && <TreeLevel nodes={folder.children} collapsed={collapsed} onToggle={onToggle} />}
    </li>
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
