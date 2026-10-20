import { useId, useState } from "react";

import type { CoreApi, PullStrategy } from "../core/api";
import { describeError } from "../core/describeError";
import { useConfirmation } from "../useConfirmation";
import { useSync } from "../useSync";

interface SyncControlsProps {
  api: CoreApi;
  worktreePath: string;
  onError: (message: string) => void;
}

/** Fetch, Pull and Push for the Tab in front, with how far its branch is from its upstream. */
export function SyncControls({ api, worktreePath, onError }: SyncControlsProps) {
  const { status, fetchFailure, fetchNow } = useSync(api, worktreePath);
  const [choosing, setChoosing] = useState(false);
  const [busy, setBusy] = useState(false);
  const { confirm, dialog } = useConfirmation(api, worktreePath);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    try {
      await action();
    } catch (failure) {
      onError(describeError(failure));
    } finally {
      setBusy(false);
    }
  }

  async function pull(strategy: PullStrategy | null, remember: boolean) {
    setChoosing(false);
    await run(() => api.pull(worktreePath, strategy, remember));
  }

  async function startPull() {
    await run(async () => {
      if (await api.pullNeedsStrategy(worktreePath)) setChoosing(true);
      else await api.pull(worktreePath, null, false);
    });
  }

  const ahead = status?.ahead ?? 0;
  const behind = status?.behind ?? 0;
  const detached = status !== null && status.branch === null;
  const diverged = ahead > 0 && behind > 0 && status?.upstream !== null;

  return (
    <div className="sync-controls" role="group" aria-label="Sync">
      {fetchFailure && (
        <span role="status" className="fetch-failed" title={fetchFailure}>
          Fetch failed
        </span>
      )}
      <button type="button" disabled={busy} onClick={() => void run(fetchNow)}>
        Fetch
      </button>
      <button
        type="button"
        disabled={busy || detached}
        title={status?.upstream ? `Pull from ${status.upstream}` : undefined}
        onClick={() => void startPull()}
      >
        Pull{behind > 0 && <span className="sync-count"> ↓{behind}</span>}
      </button>
      <button
        type="button"
        disabled={busy || detached}
        title={status?.upstream ? `Push to ${status.upstream}` : "Publish this branch"}
        onClick={() => void run(() => api.push(worktreePath, false))}
      >
        Push{ahead > 0 && <span className="sync-count"> ↑{ahead}</span>}
      </button>
      {diverged && (
        <button
          type="button"
          className="danger"
          disabled={busy}
          onClick={() =>
            void run(() =>
              confirm({ kind: "forcePush" }, () =>
                void run(() => api.push(worktreePath, true)),
              ),
            )
          }
        >
          Force push
        </button>
      )}
      {choosing && <PullStrategyDialog onChoose={pull} onCancel={() => setChoosing(false)} />}
      {dialog}
    </div>
  );
}

function PullStrategyDialog({
  onChoose,
  onCancel,
}: {
  onChoose: (strategy: PullStrategy, remember: boolean) => void;
  onCancel: () => void;
}) {
  const titleId = useId();
  const [remember, setRemember] = useState(false);

  return (
    <div className="dialog-backdrop">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="dialog"
        onKeyDown={(event) => event.key === "Escape" && onCancel()}
      >
        <h2 id={titleId}>This branch has diverged</h2>
        <div className="dialog-body">
          <p>
            Your branch and its upstream each have commits the other lacks, and your Git
            configuration does not say how to combine them.
          </p>
          <label className="option">
            <input
              type="checkbox"
              checked={remember}
              onChange={(event) => setRemember(event.target.checked)}
            />
            Remember this choice for this Repository
          </label>
        </div>
        <div className="dialog-actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" onClick={() => onChoose("merge", remember)}>
            Merge
          </button>
          <button type="button" onClick={() => onChoose("rebase", remember)}>
            Rebase
          </button>
        </div>
      </div>
    </div>
  );
}
