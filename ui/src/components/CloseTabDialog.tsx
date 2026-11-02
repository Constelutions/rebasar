import { type KeyboardEvent, useEffect, useId, useRef } from "react";

import { Button } from "./Button";

interface CloseTabDialogProps {
  /** What the Tab is called, such as `sample · main`. */
  tabName: string;
  /** What closing would lose; empty when the user asked to be asked regardless. */
  losses: string[];
  onConfirm: () => void;
  onCancel: () => void;
}

export function CloseTabDialog({ tabName, losses, onConfirm, onCancel }: CloseTabDialogProps) {
  const titleId = useId();
  const bodyId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Cancel is the default so that pressing Enter by reflex never closes the Tab.
  useEffect(() => {
    const opener = document.activeElement;
    cancelRef.current?.focus();
    return () => {
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, []);

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === "Escape") onCancel();
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
        <h2 id={titleId}>Close Tab</h2>
        <div id={bodyId} className="dialog-body">
          {losses.length === 0 ? (
            <p>Close {tabName}?</p>
          ) : (
            <>
              <p>Closing {tabName} will lose:</p>
              <ul className="loss-list" aria-label="What will be lost">
                {losses.map((loss) => (
                  <li key={loss}>{loss}</li>
                ))}
              </ul>
            </>
          )}
        </div>
        <div className="dialog-actions">
          <Button type="button" ref={cancelRef} onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" variant={losses.length > 0 ? "danger" : "secondary"} onClick={onConfirm}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
