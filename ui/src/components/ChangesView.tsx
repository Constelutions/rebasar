import { type FormEvent, useEffect, useId, useMemo, useState } from "react";

import type {
  ChangeList,
  CoreApi,
  DiffMode,
  FileChange,
  FileDiff,
  WhitespaceMode,
  WorktreeStatus,
} from "../core/api";
import { describeError } from "../core/describeError";
import { useSettings } from "../settings/SettingsContext";
import { type ChangeGroup, type GroupTree, buildGroupTrees, firstFile } from "./changeTree";
import { DiffView } from "./DiffView";
import { type FileAction, FileTree, type FileSelection } from "./FileTree";

interface ChangesViewProps {
  api: CoreApi;
  worktreePath: string;
  status: WorktreeStatus | null;
  error: string | null;
}

export function ChangesView({ api, worktreePath, status, error }: ChangesViewProps) {
  const [picked, setPicked] = useState<FileSelection<ChangeList> | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const { settings, ready } = useSettings();
  const [pickedMode, setPickedMode] = useState<DiffMode | null>(null);
  const mode = pickedMode ?? settings.diff.defaultMode;

  const trees = useMemo(() => buildGroupTrees(status ? changeGroups(status) : []), [status]);
  const selected = useMemo(() => resolveSelection(trees, picked), [trees, picked]);
  const whitespace = ready ? settings.diff.whitespace : null;
  const diff = useFileDiff(api, worktreePath, status, selected, whitespace);

  if (error) {
    return (
      <p role="alert" className="error">
        {error}
      </p>
    );
  }
  if (!status) return null;

  async function report(action: Promise<unknown>) {
    setActionError(null);
    try {
      await action;
    } catch (failure) {
      setActionError(describeError(failure));
    }
  }

  const stage: FileAction = {
    label: "Stage",
    run: (change) => void report(api.stageFiles(worktreePath, [change.path])),
  };
  const unstage: FileAction = {
    label: "Unstage",
    run: (change) => void report(api.unstageFiles(worktreePath, pathsOf(change))),
  };
  const actionFor = (list: ChangeList) =>
    list === "unstaged" ? stage : list === "staged" ? unstage : undefined;

  return (
    <div className="changes-view">
      {actionError && (
        <p role="alert" className="error">
          {actionError}
        </p>
      )}
      {trees.length === 0 ? (
        <p className="placeholder">No changes.</p>
      ) : (
        <div className="changes">
          <div className="changes-files">
            <FileTree
              trees={trees}
              selected={selected && { list: selected.list, path: selected.change.path }}
              onSelect={(list, change) => setPicked({ list, path: change.path })}
              actionFor={actionFor}
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
                onModeChange={setPickedMode}
                onLoadLarge={diff.loadLarge}
              />
            )}
          </div>
        </div>
      )}
      <CommitComposer
        canCommit={status.staged.length > 0}
        onCommit={(message) => api.commit(worktreePath, message)}
        onFailure={(failure) => setActionError(describeError(failure))}
      />
    </div>
  );
}

/** A renamed file is two index entries, so unstaging it must name both. */
function pathsOf(change: FileChange): string[] {
  return change.originalPath ? [change.path, change.originalPath] : [change.path];
}

interface CommitComposerProps {
  canCommit: boolean;
  onCommit: (message: string) => Promise<{ kind: string }>;
  onFailure: (failure: unknown) => void;
}

function CommitComposer({ canCommit, onCommit, onFailure }: CommitComposerProps) {
  const [message, setMessage] = useState("");
  const [committing, setCommitting] = useState(false);
  const messageId = useId();

  async function submit(event: FormEvent) {
    event.preventDefault();
    setCommitting(true);
    try {
      const outcome = await onCommit(message);
      if (outcome.kind === "succeeded") setMessage("");
    } catch (failure) {
      onFailure(failure);
    } finally {
      setCommitting(false);
    }
  }

  return (
    <form className="commit-composer" aria-label="Commit" onSubmit={submit}>
      <label htmlFor={messageId}>Commit message</label>
      <textarea
        id={messageId}
        rows={3}
        value={message}
        onChange={(event) => setMessage(event.target.value)}
      />
      <button type="submit" disabled={!canCommit || message.trim() === "" || committing}>
        Commit
      </button>
    </form>
  );
}

function changeGroups(status: WorktreeStatus): ChangeGroup<ChangeList>[] {
  const groups: ChangeGroup<ChangeList>[] = [
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
function resolveSelection(
  trees: GroupTree<ChangeList>[],
  picked: FileSelection<ChangeList> | null,
): Selected | null {
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
  whitespace: WhitespaceMode | null,
) {
  const [loaded, setLoaded] = useState<{ list: ChangeList; diff: FileDiff } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadedLarge, setLoadedLarge] = useState<ReadonlySet<string>>(new Set());

  const list = selected?.list;
  const path = selected?.change.path;
  const originalPath = selected?.change.originalPath ?? null;
  const forced = loadedLarge.has(`${list}:${path}`);

  useEffect(() => {
    if (!list || !path || !whitespace) return;
    let current = true;
    setError(null);
    api
      .fileDiff(worktreePath, { path, originalPath, list, loadLarge: forced, whitespace })
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
  }, [api, worktreePath, list, path, originalPath, forced, whitespace, status]);

  return {
    value: loaded && loaded.list === list && loaded.diff.path === path ? loaded.diff : null,
    error,
    loadLarge: () => setLoadedLarge((current) => new Set(current).add(`${list}:${path}`)),
  };
}
