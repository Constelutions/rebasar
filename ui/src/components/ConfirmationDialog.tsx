import { type KeyboardEvent, useEffect, useId, useRef } from "react";

import type { Loss } from "../core/api";
import { Button } from "./Button";
import { LineCounts, statusLetters } from "./FileTree";

export interface ConfirmationDialogProps {
  title: string;
  confirmLabel: string;
  loss: Loss;
  /** Who else is affected, for a Mutation that reaches beyond this machine. */
  warning?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmationDialog({
  title,
  confirmLabel,
  loss,
  warning,
  onConfirm,
  onCancel,
}: ConfirmationDialogProps) {
  const titleId = useId();
  const bodyId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  // Cancel is the default so that pressing Enter by reflex never destroys work.
  useEffect(() => {
    const opener = document.activeElement;
    cancelRef.current?.focus();
    return () => {
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, []);

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      onCancel();
    } else if (event.key === "Tab") {
      const [first, last] = [cancelRef.current, confirmRef.current];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
  }

  return (
    <div className="dialog-backdrop">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        className="dialog"
        onKeyDown={onKeyDown}
      >
        <h2 id={titleId}>{title}</h2>
        <div id={bodyId} className="dialog-body">
          {loss.files.length > 0 && (
            <>
              <p>
                {plural(loss.files.length, "file")} with uncommitted changes will be lost:
              </p>
              <ul className="loss-files" aria-label="Files that will be lost">
                {loss.files.map((file) => (
                  <li key={file.path}>
                    <span className={`status-letter status-${file.kind}`}>
                      {statusLetters[file.kind].letter}
                    </span>
                    <span className="loss-path">{file.path}</span>
                    <LineCounts added={file.added} removed={file.removed} />
                  </li>
                ))}
              </ul>
            </>
          )}
          {loss.commits > 0 && (
            <p>
              {plural(loss.commits, "commit")} will no longer be reachable from any branch
              {loss.unpushedCommits > 0 &&
                `, and ${loss.unpushedCommits} of them ${loss.unpushedCommits === 1 ? "exists" : "exist"} on no remote`}
              .
            </p>
          )}
          {loss.commitList.length > 0 && (
            <>
              <ul className="loss-commits" aria-label="Commits that will be lost">
                {loss.commitList.map((commit) => (
                  <li key={commit.shortId}>
                    <code className="loss-id">{commit.shortId}</code>
                    <span className="loss-path">{commit.subject}</span>
                  </li>
                ))}
              </ul>
              {loss.commits > loss.commitList.length && (
                <p>and {loss.commits - loss.commitList.length} more</p>
              )}
            </>
          )}
          {warning && <p className="dialog-warning">{warning}</p>}
          <p className="dialog-recovery">
            Rebasar has no undo. Git&apos;s reflog is the only recovery path
            {loss.files.length > 0 && ", and it does not record uncommitted changes"}.
          </p>
        </div>
        <div className="dialog-actions">
          <Button type="button" ref={cancelRef} onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" ref={confirmRef} variant="danger" onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
