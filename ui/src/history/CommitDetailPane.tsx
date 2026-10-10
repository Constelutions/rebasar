import { useEffect, useMemo, useState } from "react";

import { DiffView } from "../components/DiffView";
import { FileTree } from "../components/FileTree";
import { type GroupTree, buildGroupTrees, firstFile } from "../components/changeTree";
import type { CommitDetail, CoreApi, DiffMode, FileChange } from "../core/api";
import { describeError } from "../core/describeError";
import { useSettings } from "../settings/SettingsContext";
import { formatDateTime } from "./items";
import { useCommitFileDiff } from "./useCommitFileDiff";

interface CommitDetailPaneProps {
  api: CoreApi;
  worktreePath: string;
  commitId: string;
  onClose: () => void;
}

/** Shows one commit; the caller keys it by commit so that nothing carries over to the next one. */
export function CommitDetailPane({ api, worktreePath, commitId, onClose }: CommitDetailPaneProps) {
  const [parent, setParent] = useState(0);
  const { loaded, error } = useCommitDetail(api, worktreePath, commitId, parent);

  return (
    <section className="commit-detail" aria-label="Commit detail">
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {loaded && (
        <CommitBody
          api={api}
          worktreePath={worktreePath}
          detail={loaded.detail}
          comparedParent={loaded.parent}
          onParentChange={setParent}
        />
      )}
      <button
        type="button"
        className="commit-detail-close"
        aria-label="Close commit detail"
        onClick={onClose}
      >
        ×
      </button>
    </section>
  );
}

interface CommitBodyProps {
  api: CoreApi;
  worktreePath: string;
  detail: CommitDetail;
  comparedParent: number;
  onParentChange: (parent: number) => void;
}

function CommitBody({ api, worktreePath, detail, comparedParent, onParentChange }: CommitBodyProps) {
  const [pickedPath, setPickedPath] = useState<string | null>(null);
  const { settings } = useSettings();
  const [pickedMode, setPickedMode] = useState<DiffMode | null>(null);
  const mode = pickedMode ?? settings.diff.defaultMode;
  const [subject, ...bodyLines] = detail.message.split("\n");
  const body = bodyLines.join("\n").trim();

  const trees = useMemo(
    () =>
      buildGroupTrees(
        detail.files.length > 0
          ? [{ list: "commit", name: "Changed files", changes: detail.files }]
          : [],
      ),
    [detail.files],
  );
  const selected = resolveSelection(detail.files, pickedPath, trees);
  const diff = useCommitFileDiff(api, worktreePath, detail.id, comparedParent, selected);

  return (
    <>
      <h2 className="commit-detail-subject">{subject}</h2>
      {body && <p className="commit-detail-body">{body}</p>}
      <dl className="commit-meta">
        <dt>Author</dt>
        <dd>
          {detail.authorName} &lt;{detail.authorEmail}&gt;
        </dd>
        <dt>Date</dt>
        <dd>
          <time dateTime={new Date(detail.authorTimestamp * 1000).toISOString()}>
            {formatDateTime(detail.authorTimestamp)}
          </time>
        </dd>
        <dt>Commit</dt>
        <dd className="commit-id">{detail.id}</dd>
        <dt>{detail.parents.length > 1 ? "Parents" : "Parent"}</dt>
        <dd>
          {detail.parents.length === 0 ? (
            "Root commit"
          ) : (
            <ul className="commit-parents">
              {detail.parents.map((parent) => (
                <li key={parent.id}>
                  <code>{parent.shortId}</code> {parent.subject}
                </li>
              ))}
            </ul>
          )}
        </dd>
      </dl>
      {detail.parents.length > 1 && (
        <div role="group" aria-label="Compare with parent" className="mode-toggle parent-toggle">
          {detail.parents.map((parent, index) => (
            <button
              key={parent.id}
              type="button"
              aria-pressed={comparedParent === index}
              onClick={() => onParentChange(index)}
            >
              Parent {index + 1}
            </button>
          ))}
        </div>
      )}
      {detail.files.length === 0 ? (
        <p className="placeholder">No files changed.</p>
      ) : (
        <div className="changes">
          <div className="changes-files">
            <FileTree
              trees={trees}
              selected={selected && { list: "commit", path: selected.path }}
              onSelect={(_, change) => setPickedPath(change.path)}
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
                key={`${comparedParent}:${diff.value.path}`}
                diff={diff.value}
                mode={mode}
                onModeChange={setPickedMode}
                onLoadLarge={diff.loadLarge}
              />
            )}
          </div>
        </div>
      )}
    </>
  );
}

/** Keeps the file the user picked while the commit still lists it; otherwise falls back to the first. */
function resolveSelection(
  files: FileChange[],
  pickedPath: string | null,
  trees: GroupTree<"commit">[],
): FileChange | null {
  return files.find((file) => file.path === pickedPath) ?? firstFile(trees)?.change ?? null;
}

function useCommitDetail(api: CoreApi, worktreePath: string, commitId: string, parent: number) {
  const [loaded, setLoaded] = useState<{ parent: number; detail: CommitDetail } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    setError(null);
    api.commitDetail(worktreePath, commitId, parent).then(
      (detail) => {
        if (current) setLoaded({ parent, detail });
      },
      (failure) => {
        if (current) setError(describeError(failure));
      },
    );
    return () => {
      current = false;
    };
  }, [api, worktreePath, commitId, parent]);

  return { loaded, error };
}
