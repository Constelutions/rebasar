import { type FormEvent, useId, useState } from "react";

import type { CoreApi, PullRequestDetails } from "../core/api";
import { describeError } from "../core/describeError";
import { Button } from "./Button";
import { TextArea, TextInput } from "./FormControls";

interface PullRequestDialogProps {
  api: CoreApi;
  worktreePath: string;
  /** Set to change a pull request that exists; unset to open a new one. */
  existing: PullRequestDetails | null;
  initialTitle?: string;
  onClose: () => void;
  /** Called with what GitHub now holds. */
  onSaved: (pullRequest: PullRequestDetails) => void;
}

export function PullRequestDialog({
  api,
  worktreePath,
  existing,
  initialTitle = "",
  onClose,
  onSaved,
}: PullRequestDialogProps) {
  const titleId = useId();
  const nameId = useId();
  const bodyId = useId();
  const [title, setTitle] = useState(existing?.title ?? initialTitle);
  const [body, setBody] = useState(existing?.body ?? "");
  const [draft, setDraft] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (title.trim() === "" || busy) return;
    setBusy(true);
    setError(null);
    try {
      const saved = existing
        ? await api.updatePullRequest(worktreePath, existing.number, title, body)
        : await api.createPullRequest(worktreePath, title, body, draft);
      onSaved(saved);
      onClose();
    } catch (failure) {
      setError(describeError(failure));
      setBusy(false);
    }
  }

  return (
    <div className="dialog-backdrop">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="dialog"
        onKeyDown={(event) => event.key === "Escape" && !busy && onClose()}
      >
        <h2 id={titleId}>
          {existing ? `Edit pull request #${existing.number}` : "Create a pull request"}
        </h2>
        <form className="add-form" onSubmit={submit}>
          <label htmlFor={nameId}>Title</label>
          <TextInput id={nameId} value={title} onChange={(event) => setTitle(event.target.value)} autoFocus />
          <label htmlFor={bodyId}>Description</label>
          <TextArea id={bodyId} rows={8} value={body} onChange={(event) => setBody(event.target.value)} />
          {!existing && (
            <label className="option">
              <input type="checkbox" checked={draft} onChange={(event) => setDraft(event.target.checked)} />
              Open as a draft
            </label>
          )}
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <Button type="button" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" disabled={title.trim() === "" || busy}>
              {existing ? "Update pull request" : "Create pull request"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
