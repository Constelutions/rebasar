import { useEffect, useMemo, useState } from "react";

import type {
  ChangeList,
  CoreApi,
  DiffMode,
  FileChange,
  FileDiff,
  OutgoingCommit,
  PullRequestDetails,
  WhitespaceMode,
  WorktreeStatus,
} from "../core/api";
import { describeError } from "../core/describeError";
import { useSettings } from "../settings/SettingsContext";
import { useConfirmation } from "../useConfirmation";
import { Button } from "./Button";
import { type ChangeGroup, type GroupTree, buildGroupTrees, firstFile } from "./changeTree";
import { CommitComposer } from "./CommitComposer";
import { DiffView, type LineStaging } from "./DiffView";
import { PullRequestDialog } from "./PullRequestDialog";
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
  const [pushedPullRequest, setPushedPullRequest] = useState<PullRequestDetails | null>(null);
  const [editingPullRequest, setEditingPullRequest] = useState(false);
  const { outgoing, outgoingError } = useOutgoingCommits(api, worktreePath);
  const { confirm, dialog } = useConfirmation(api, worktreePath);
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
  function discard(paths: string[]) {
    void report(
      confirm({ kind: "discardChanges", paths }, () =>
        void report(api.discardChanges(worktreePath, paths)),
      ),
    );
  }
  const discardFile: FileAction = {
    label: "Discard",
    destructive: true,
    run: (change) => discard([change.path]),
  };
  const staging: LineStaging | undefined =
    selected && selected.list !== "conflicts"
      ? {
          label: selected.list === "staged" ? "Unstage" : "Stage",
          apply: (lines) => {
            // The file also appears in the other list once partly staged; stay on this one.
            setPicked({ list: selected.list, path: selected.change.path });
            const selection = {
              path: selected.change.path,
              originalPath: selected.change.originalPath,
              lines,
            };
            void report(
              selected.list === "staged"
                ? api.unstageLines(worktreePath, selection)
                : api.stageLines(worktreePath, selection),
            );
          },
        }
      : undefined;
  const actionsFor = (list: ChangeList): FileAction[] =>
    list === "unstaged" ? [stage, discardFile] : list === "staged" ? [unstage] : [];
  const groupActionFor = (list: ChangeList) =>
    list === "unstaged"
      ? { label: "Discard all", run: () => discard(status.unstaged.map((change) => change.path)) }
      : undefined;

  return (
    <div className="changes-view">
      <div className="changes-column">
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
                actionsFor={actionsFor}
                groupActionFor={groupActionFor}
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
                  staging={staging}
                />
              )}
            </div>
          </div>
        )}
      </div>
      {dialog}
      {pushedPullRequest && (
        <p role="status" className="pull-request-offer">
          Pushed. Pull request #{pushedPullRequest.number} is open for this branch.{" "}
          <Button type="button" onClick={() => setEditingPullRequest(true)}>
            Update pull request
          </Button>
        </p>
      )}
      {editingPullRequest && (
        <PullRequestDialog
          api={api}
          worktreePath={worktreePath}
          existing={pushedPullRequest}
          onClose={() => setEditingPullRequest(false)}
          onSaved={setPushedPullRequest}
        />
      )}
      <CommitComposer
        hasStagedFiles={status.staged.length > 0}
        outgoing={outgoing}
        outgoingError={outgoingError}
        onCommit={(message, options) => api.commit(worktreePath, message, options)}
        onPush={async () => {
          const outcome = await api.push(worktreePath, false);
          if (outcome.kind === "succeeded") {
            // Not signed in, or not a GitHub remote: there is simply no pull request to offer.
            setPushedPullRequest(await api.currentPullRequest(worktreePath).catch(() => null));
          }
          return outcome;
        }}
        onFailure={(failure) => setActionError(describeError(failure))}
      />
    </div>
  );
}

/** A renamed file is two index entries, so unstaging it must name both. */
function pathsOf(change: FileChange): string[] {
  return change.originalPath ? [change.path, change.originalPath] : [change.path];
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

/** The commits the branch has that its upstream lacks; read again whenever the core reports a change. */
function useOutgoingCommits(api: CoreApi, worktreePath: string) {
  const [outgoing, setOutgoing] = useState<OutgoingCommit[]>([]);
  const [outgoingError, setOutgoingError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    let latestRequest = 0;

    async function refresh() {
      const request = ++latestRequest;
      try {
        const commits = await api.outgoingCommits(worktreePath);
        if (!current || request !== latestRequest) return;
        setOutgoing(commits);
        setOutgoingError(null);
      } catch (failure) {
        if (!current || request !== latestRequest) return;
        setOutgoingError(describeError(failure));
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

  return { outgoing, outgoingError };
}
