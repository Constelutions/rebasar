import { useEffect, useState } from "react";

import type { CoreApi, FileChange, FileDiff } from "../core/api";
import { describeError } from "../core/describeError";

/** What a commit's files are diffed against: one of its parents, or the files on disk. */
export type DiffBase = number | "worktree";

/** Reads one file's diff in a commit; a file that comes back collapsed is read in full on `loadLarge`. */
export function useCommitFileDiff(
  api: CoreApi,
  worktreePath: string,
  commit: string,
  base: DiffBase,
  file: FileChange | null,
) {
  const [loaded, setLoaded] = useState<{ key: string; diff: FileDiff } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadedLarge, setLoadedLarge] = useState<ReadonlySet<string>>(new Set());

  const path = file?.path;
  const originalPath = file?.originalPath ?? null;
  const key = `${base}:${path}`;
  const forced = loadedLarge.has(key);

  useEffect(() => {
    if (!path) return;
    let current = true;
    setError(null);
    const read =
      base === "worktree"
        ? api.compareFileDiff(worktreePath, { commit, path, loadLarge: forced })
        : api.commitFileDiff(worktreePath, {
            commit,
            parent: base,
            path,
            originalPath,
            loadLarge: forced,
          });
    read
      .then((diff) => {
        if (current) setLoaded({ key, diff });
      })
      .catch((failure) => {
        if (current) setError(describeError(failure));
      });
    return () => {
      current = false;
    };
  }, [api, worktreePath, commit, base, path, originalPath, key, forced]);

  return {
    value: loaded?.key === key ? loaded.diff : null,
    error,
    loadLarge: () => setLoadedLarge((current) => new Set(current).add(key)),
  };
}
