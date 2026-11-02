import { type FormEvent, useEffect, useId, useState } from "react";

import { Button } from "../components/Button";
import type { CoreApi, MutationOutcome } from "../core/api";
import { describeError } from "../core/describeError";

export type CommitDialog = "branch" | "tag" | "reword";

interface CommitActionDialogProps {
  api: CoreApi;
  worktreePath: string;
  kind: CommitDialog;
  commitId: string;
  shortId: string;
  /** Only the commit HEAD points at can be reworded here; older ones need the rebase editor. */
  isLatest: boolean;
  onClose: () => void;
  /** Opens the interactive rebase editor at this commit. */
  onOpenRebaseEditor: () => void;
}

export function CommitActionDialog({
  api,
  worktreePath,
  kind,
  commitId,
  shortId,
  isLatest,
  onClose,
  onOpenRebaseEditor,
}: CommitActionDialogProps) {
  if (kind === "reword" && !isLatest) {
    return (
      <Frame title={`Reword ${shortId}`} onClose={onClose}>
        <p>
          Only the latest commit can be reworded here. To reword {shortId}, start an interactive
          rebase from it and choose reword: the interactive rebase editor applies the new message.
        </p>
        <div className="dialog-actions">
          <Button type="button" onClick={onClose}>
            Close
          </Button>
          <Button type="button" onClick={onOpenRebaseEditor}>
            Open the interactive rebase editor
          </Button>
        </div>
      </Frame>
    );
  }
  if (kind === "reword") {
    return (
      <RewordForm
        api={api}
        worktreePath={worktreePath}
        commitId={commitId}
        shortId={shortId}
        onClose={onClose}
      />
    );
  }
  return (
    <NameForm
      api={api}
      worktreePath={worktreePath}
      kind={kind}
      commitId={commitId}
      shortId={shortId}
      onClose={onClose}
    />
  );
}

function Frame({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const titleId = useId();
  return (
    <div className="dialog-backdrop">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="dialog"
        onKeyDown={(event) => event.key === "Escape" && onClose()}
      >
        <h2 id={titleId}>{title}</h2>
        {children}
      </div>
    </div>
  );
}

/** Runs the action; the dialog closes when Git accepted it and explains otherwise. */
function useAttempt(onClose: () => void, rejection: string) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function attempt(action: () => Promise<MutationOutcome>) {
    setError(null);
    setBusy(true);
    try {
      const outcome = await action();
      if (outcome.kind === "failed") {
        setError(rejection);
        setBusy(false);
      } else {
        onClose();
      }
    } catch (failure) {
      setError(describeError(failure));
      setBusy(false);
    }
  }

  return { error, busy, attempt };
}

function NameForm({
  api,
  worktreePath,
  kind,
  commitId,
  shortId,
  onClose,
}: Pick<CommitActionDialogProps, "api" | "worktreePath" | "commitId" | "shortId" | "onClose"> & {
  kind: "branch" | "tag";
}) {
  const [name, setName] = useState("");
  const inputId = useId();
  const noun = kind === "branch" ? "Branch" : "Tag";
  const { error, busy, attempt } = useAttempt(
    onClose,
    `Git rejected that name, or the ${kind} already exists. Details are in the output panel.`,
  );

  function submit(event: FormEvent) {
    event.preventDefault();
    if (name.trim() === "" || busy) return;
    void attempt(() =>
      kind === "branch"
        ? api.createBranch(worktreePath, name.trim(), commitId)
        : api.createTag(worktreePath, name.trim(), commitId),
    );
  }

  return (
    <Frame title={`Create ${kind} at ${shortId}`} onClose={onClose}>
      <form className="add-form" onSubmit={submit}>
        <label htmlFor={inputId}>{noun} name</label>
        <input id={inputId} value={name} onChange={(event) => setName(event.target.value)} autoFocus />
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={name.trim() === "" || busy}>
            Create {kind}
          </Button>
        </div>
      </form>
    </Frame>
  );
}

function RewordForm({
  api,
  worktreePath,
  commitId,
  shortId,
  onClose,
}: Pick<CommitActionDialogProps, "api" | "worktreePath" | "commitId" | "shortId" | "onClose">) {
  const [message, setMessage] = useState<string | null>(null);
  const inputId = useId();
  const { error, busy, attempt } = useAttempt(
    onClose,
    "Git did not accept the new message. Details are in the output panel.",
  );
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    api.commitDetail(worktreePath, commitId, 0).then(
      (detail) => current && setMessage(detail.message),
      (failure) => current && setLoadError(describeError(failure)),
    );
    return () => {
      current = false;
    };
  }, [api, worktreePath, commitId]);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (message === null || message.trim() === "" || busy) return;
    void attempt(() => api.rewordLatestCommit(worktreePath, commitId, message));
  }

  return (
    <Frame title={`Reword ${shortId}`} onClose={onClose}>
      <form className="add-form" onSubmit={submit}>
        <label htmlFor={inputId}>Commit message</label>
        <textarea
          id={inputId}
          rows={8}
          value={message ?? ""}
          disabled={message === null}
          onChange={(event) => setMessage(event.target.value)}
        />
        {(error ?? loadError) && (
          <p role="alert" className="error">
            {error ?? loadError}
          </p>
        )}
        <div className="dialog-actions">
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={message === null || message.trim() === "" || busy}>
            Reword
          </Button>
        </div>
      </form>
    </Frame>
  );
}
