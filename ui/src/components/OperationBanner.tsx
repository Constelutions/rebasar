import { useState } from "react";

import type { CoreApi, OperationInProgress, OperationKind } from "../core/api";
import { describeError } from "../core/describeError";
import { RebaseEditor } from "./RebaseEditor";
import { useConfirmation } from "../useConfirmation";

const names: Record<OperationKind, string> = {
  merge: "Merge",
  rebase: "Rebase",
  cherryPick: "Cherry-pick",
  revert: "Revert",
};

interface OperationBannerProps {
  api: CoreApi;
  worktreePath: string;
  operation: OperationInProgress;
}

/** Shown on every view of a Tab while Git is paused, so the state is never out of sight. */
export function OperationBanner({ api, worktreePath, operation }: OperationBannerProps) {
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const { confirm, dialog } = useConfirmation(api, worktreePath);
  const name = names[operation.kind];

  function run(action: () => Promise<unknown>) {
    setError(null);
    action().catch((failure) => setError(describeError(failure)));
  }

  return (
    <section aria-label="Operation in progress" className="operation-banner">
      <p className="operation-summary">
        <strong>{name} in progress</strong>
        {operation.step && (
          <span>
            {" "}
            · commit {operation.step.current} of {operation.step.total}
          </span>
        )}
        <span>
          {" "}
          · {operation.conflicts === 0 ? "no conflicts" : plural(operation.conflicts, "conflict")}
        </span>
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="operation-actions">
        <button
          type="button"
          disabled={operation.conflicts > 0}
          title={operation.conflicts > 0 ? "Resolve the conflicts first" : undefined}
          onClick={() => run(() => api.continueOperation(worktreePath))}
        >
          Continue
        </button>
        {operation.canSkip && (
          <button type="button" onClick={() => run(() => api.skipOperation(worktreePath))}>
            Skip
          </button>
        )}
        {operation.kind === "rebase" && (
          <button type="button" onClick={() => setEditing(true)}>
            Edit plan
          </button>
        )}
        <button
          type="button"
          className="danger"
          onClick={() =>
            run(() =>
              confirm({ kind: "abortOperation" }, () =>
                run(() => api.abortOperation(worktreePath)),
              ),
            )
          }
        >
          Abort
        </button>
      </div>
      {dialog}
      {editing && (
        <RebaseEditor
          api={api}
          worktreePath={worktreePath}
          from={null}
          onClose={() => setEditing(false)}
        />
      )}
    </section>
  );
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
