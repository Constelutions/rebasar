import { useEffect, useState } from "react";

import type { CoreApi } from "../core/api";
import type { HistoryItem } from "./items";

/** The branches of the Worktree's Repository, local ones first, for the Branches select. */
export function useBranchNames(api: CoreApi, worktreePath: string): string[] {
  const [names, setNames] = useState<string[]>([]);

  useEffect(() => {
    let current = true;
    api.listBranches(worktreePath).then(
      (labels) => {
        if (!current) return;
        const branches = labels.filter(({ kind }) => kind === "localBranch" || kind === "remoteBranch");
        const local = branches.filter(({ kind }) => kind === "localBranch");
        const remote = branches.filter(({ kind }) => kind === "remoteBranch");
        setNames([...local, ...remote].map(({ name }) => name));
      },
      () => {
        // The select still works from the query without the list; History reports a broken Worktree itself.
      },
    );
    return () => {
      current = false;
    };
  }, [api, worktreePath]);

  return names;
}

/**
 * The authors of the commits loaded so far, newest committer first. They are only added, never dropped,
 * so choosing one author does not make the others vanish from the list as the rows narrow.
 */
export function useAuthorNames(items: HistoryItem[]): string[] {
  const [names, setNames] = useState<string[]>([]);

  useEffect(() => {
    setNames((current) => {
      const known = new Set(current);
      const added: string[] = [];
      for (const item of items) {
        if (item.kind !== "commit" || known.has(item.row.authorName)) continue;
        known.add(item.row.authorName);
        added.push(item.row.authorName);
      }
      return added.length === 0 ? current : [...current, ...added];
    });
  }, [items]);

  return names;
}
