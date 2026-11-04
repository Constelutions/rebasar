import { type FormEvent, useId, useState } from "react";

import type { CommitOptions, OutgoingCommit } from "../core/api";
import { useSettings } from "../settings/SettingsContext";
import { type CommitDraft, emptyDraft } from "../useCommitDrafts";
import { Button } from "./Button";
import { COMMIT_TYPES, SUBJECT_LIMIT, subjectOf, typeOf, withType } from "./conventionalCommit";
import { TextArea } from "./FormControls";

const MESSAGE_EXAMPLE = "feat(history): filter commits by author\n\nExplain what changed and why.";
const AMEND_HINT = "Leave empty to keep the previous message";

interface CommitComposerProps {
  draft: CommitDraft;
  onDraftChange: (draft: CommitDraft) => void;
  hasStagedFiles: boolean;
  outgoing: OutgoingCommit[];
  outgoingError: string | null;
  onCommit: (message: string, options: CommitOptions) => Promise<{ kind: string }>;
  /** Publishes the new commit; runs only after the commit succeeded. */
  onPush: () => Promise<{ kind: string }>;
  onFailure: (failure: unknown) => void;
}

export function CommitComposer({
  draft,
  onDraftChange,
  hasStagedFiles,
  outgoing,
  outgoingError,
  onCommit,
  onPush,
  onFailure,
}: CommitComposerProps) {
  const { message } = draft;
  const { settings } = useSettings();
  const [amend, setAmend] = useState(false);
  const [signOffChoice, setSignOffChoice] = useState<boolean | null>(null);
  const [committing, setCommitting] = useState(false);
  const messageId = useId();
  const counterId = useId();

  const signOff = signOffChoice ?? settings.commit.signOffByDefault;
  const subject = subjectOf(message);
  const selectedType = typeOf(message);
  const hasValidMessage = subject.trim() !== "" || (amend && message.trim() === "");
  const canCommit = hasValidMessage && (amend || hasStagedFiles) && !committing;
  const action = amend ? "Amend" : "Commit";

  async function run(push: boolean) {
    setCommitting(true);
    try {
      const outcome = await onCommit(message.trim(), { amend, signOff });
      if (outcome.kind === "succeeded") {
        onDraftChange(emptyDraft);
        setAmend(false);
        if (push) await onPush();
      }
    } catch (failure) {
      onFailure(failure);
    } finally {
      setCommitting(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void run(false);
  }

  return (
    <aside className="commit-dock">
      <form className="commit-composer" aria-label="Commit" onSubmit={submit}>
        <div className="type-chips" role="group" aria-label="Commit type">
          {COMMIT_TYPES.map((type) => (
            <Button
              variant="plain"
              key={type}
              type="button"
              className="type-chip"
              aria-pressed={selectedType === type}
              onClick={() =>
                onDraftChange({ message: withType(message, selectedType === type ? undefined : type) })
              }
            >
              {type}
            </Button>
          ))}
        </div>

        <div className="subject-line">
          <label htmlFor={messageId}>Commit message</label>
          <span
            id={counterId}
            className="subject-counter"
            data-over-limit={subject.length > SUBJECT_LIMIT}
          >
            {subject.length} / {SUBJECT_LIMIT}
          </span>
        </div>
        <TextArea
          id={messageId}
          rows={8}
          value={message}
          aria-describedby={counterId}
          placeholder={amend ? AMEND_HINT : MESSAGE_EXAMPLE}
          onChange={(event) => onDraftChange({ message: event.target.value })}
        />

        <label className="option">
          <input type="checkbox" checked={amend} onChange={(e) => setAmend(e.target.checked)} />
          Amend previous commit
        </label>
        <label className="option">
          <input
            type="checkbox"
            checked={signOff}
            onChange={(event) => setSignOffChoice(event.target.checked)}
          />
          Sign off
        </label>

        <div className="commit-actions">
          <Button variant="primary" type="submit" disabled={!canCommit}>
            {amend ? "Amend commit" : "Commit"}
          </Button>
          <Button type="button" disabled={!canCommit} onClick={() => void run(true)}>
            {action} &amp; Push
          </Button>
        </div>
      </form>

      <OutgoingList
        outgoing={outgoing}
        error={outgoingError}
        pending={
          hasStagedFiles || amend
            ? { subject: subject.trim(), replacesHead: amend }
            : undefined
        }
      />
    </aside>
  );
}

interface PendingCommit {
  subject: string;
  /** An amend takes the place of the newest outgoing commit instead of adding one. */
  replacesHead: boolean;
}

function OutgoingList({
  outgoing,
  error,
  pending,
}: {
  outgoing: OutgoingCommit[];
  error: string | null;
  pending: PendingCommit | undefined;
}) {
  const replaced = pending?.replacesHead ? outgoing[0] : undefined;
  const pushed = replaced ? outgoing.slice(1) : outgoing;
  const pendingSubject = pending?.subject || replaced?.subject || "(no subject yet)";

  return (
    <section className="outgoing" aria-label="Outgoing commits">
      <h2>Outgoing</h2>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {!pending && pushed.length === 0 ? (
        <p className="placeholder">Nothing to push.</p>
      ) : (
        <ol className="outgoing-list">
          {pending && (
            <li className="outgoing-pending">
              <span className="commit-hash">pending</span>
              <span className="commit-subject">{pendingSubject}</span>
            </li>
          )}
          {pushed.map((commit) => (
            <li key={commit.id}>
              <span className="commit-hash">{commit.shortId}</span>
              <span className="commit-subject">{commit.subject}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
