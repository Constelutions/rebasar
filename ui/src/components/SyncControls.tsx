import { useId, useState } from "react";

import type { CoreApi, PullStrategy } from "../core/api";
import { describeError } from "../core/describeError";
import { useConfirmation } from "../useConfirmation";
import { useSync } from "../useSync";
import { ActionIcon } from "./ActionIcons";
import { Button } from "./Button";

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
      <Button
        type="button"
        className="icon-button"
        aria-label="Fetch"
        title="Fetch"
        disabled={busy}
        onClick={() => void run(fetchNow)}
      >
        <ActionIcon name="fetch" />
      </Button>
      <Button
        type="button"
        className="icon-button"
        aria-label={behind > 0 ? `Pull, ${behind} behind` : "Pull"}
        disabled={busy || detached}
        title={status?.upstream ? `Pull from ${status.upstream}` : "Pull"}
        onClick={() => void startPull()}
      >
        <ActionIcon name="pull" />
        {behind > 0 && <span className="sync-count">↓{behind}</span>}
      </Button>
      <Button
        type="button"
        className="icon-button"
        aria-label={ahead > 0 ? `Push, ${ahead} ahead` : "Push"}
        disabled={busy || detached}
        title={status?.upstream ? `Push to ${status.upstream}` : "Publish this branch"}
        onClick={() => void run(() => api.push(worktreePath, false))}
      >
        <ActionIcon name="push" />
        {ahead > 0 && <span className="sync-count">↑{ahead}</span>}
      </Button>
      {diverged && (
        <Button
          type="button"
          variant="danger"
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
        </Button>
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
          <Button type="button" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" onClick={() => onChoose("merge", remember)}>
            Merge
          </Button>
          <Button type="button" onClick={() => onChoose("rebase", remember)}>
            Rebase
          </Button>
        </div>
      </div>
    </div>
  );
}
