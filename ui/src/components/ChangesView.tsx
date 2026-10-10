import { useEffect, useMemo, useState } from "react";

import type { ChangeList, CoreApi, FileChange, FileDiff, Tab, WorktreeStatus } from "../core/api";
import { describeError } from "../core/describeError";
import { type ChangeGroup, type GroupTree, buildGroupTrees, firstFile } from "./changeTree";
import { DiffView } from "./DiffView";
import type { DiffMode } from "./diffRows";
import { FileTree, type FileSelection } from "./FileTree";

export function ChangesView({ api, tab }: { api: CoreApi; tab: Tab }) {
  const { status, error } = useWorktreeStatus(api, tab.worktreePath);
  const [picked, setPicked] = useState<FileSelection | null>(null);
  const [mode, setMode] = useState<DiffMode>("unified");

  const trees = useMemo(() => buildGroupTrees(status ? changeGroups(status) : []), [status]);
  const selected = useMemo(() => resolveSelection(trees, picked), [trees, picked]);
  const diff = useFileDiff(api, tab.worktreePath, status, selected);

  if (error) {
    return (
      <p role="alert" className="error">
        {error}
      </p>
    );
  }
  if (!status) return null;
  if (trees.length === 0) return <p className="placeholder">No changes.</p>;

  return (
    <div className="changes">
      <div className="changes-files">
        <FileTree
          trees={trees}
          selected={selected && { list: selected.list, path: selected.change.path }}
          onSelect={(list, change) => setPicked({ list, path: change.path })}
        />
      </div>
      <div className="changes-diff">
        {diff.error && (
          <p role="alert" className="error">
            {diff.error}
          </p>
        )}
        {diff.value && (
          <DiffView
            key={`${selected?.list}:${diff.value.path}`}
            diff={diff.value}
            mode={mode}
            onModeChange={setMode}
            onLoadLarge={diff.loadLarge}
          />
        )}
      </div>
    </div>
  );
}

function changeGroups(status: WorktreeStatus): ChangeGroup[] {
  const groups: ChangeGroup[] = [
    { list: "conflicts", name: "Conflicts", changes: status.conflicts },
    { list: "staged", name: "Staged", changes: status.staged },
    { list: "unstaged", name: "Unstaged", changes: status.unstaged },
  ];
  return groups.filter((group) => group.changes.length > 0);
}

interface Selected {
  list: ChangeList;
  change: FileChange;
}

/** Keeps the file the user picked while it is still changed; otherwise falls back to the first. */
function resolveSelection(trees: GroupTree[], picked: FileSelection | null): Selected | null {
  const change = trees
    .find(({ group }) => group.list === picked?.list)
    ?.group.changes.find((candidate) => candidate.path === picked?.path);
  if (picked && change) return { list: picked.list, change };
  return firstFile(trees);
}

function useFileDiff(
  api: CoreApi,
  worktreePath: string,
  status: WorktreeStatus | null,
  selected: Selected | null,
) {
  const [loaded, setLoaded] = useState<{ list: ChangeList; diff: FileDiff } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadedLarge, setLoadedLarge] = useState<ReadonlySet<string>>(new Set());

  const list = selected?.list;
  const path = selected?.change.path;
  const originalPath = selected?.change.originalPath ?? null;
  const forced = loadedLarge.has(`${list}:${path}`);

  useEffect(() => {
    if (!list || !path) return;
    let current = true;
    setError(null);
    api
      .fileDiff(worktreePath, { path, originalPath, list, loadLarge: forced })
      .then((fresh) => {
        if (!current) return;
        setLoaded({ list, diff: fresh });
        setError(null);
      })
      .catch((failure) => {
        if (current) setError(describeError(failure));
      });
    return () => {
      current = false;
    };
    // A new status means the file may have changed on disk, so its diff is read again.
  }, [api, worktreePath, list, path, originalPath, forced, status]);

  return {
    value: loaded && loaded.list === list && loaded.diff.path === path ? loaded.diff : null,
    error,
    loadLarge: () => setLoadedLarge((current) => new Set(current).add(`${list}:${path}`)),
  };
}

function useWorktreeStatus(api: CoreApi, worktreePath: string) {
  const [status, setStatus] = useState<WorktreeStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    let latestRequest = 0;
    setStatus(null);
    setError(null);

    async function refresh() {
      const request = ++latestRequest;
      try {
        const fresh = await api.worktreeStatus(worktreePath);
        if (!current || request !== latestRequest) return;
        setStatus(fresh);
        setError(null);
      } catch (failure) {
        if (!current || request !== latestRequest) return;
        setError(describeError(failure));
      }
    }

    void refresh();
    const subscription = api.onEvent((event) => {
      if (event.type === "worktreeChanged" && event.worktreePath === worktreePath) {
        void refresh();
      }
    });
    return () => {
      current = false;
      void subscription.then((unsubscribe) => unsubscribe());
    };
  }, [api, worktreePath]);

  return { status, error };
}
