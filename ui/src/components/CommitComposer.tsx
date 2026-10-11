import { type FormEvent, useId, useState } from "react";

import type { CommitOptions, OutgoingCommit } from "../core/api";
import {
  COMMIT_TYPES,
  SUBJECT_LIMIT,
  messageOf,
  typeOf,
  withType,
} from "./conventionalCommit";

interface CommitComposerProps {
  hasStagedFiles: boolean;
  outgoing: OutgoingCommit[];
  outgoingError: string | null;
  onCommit: (message: string, options: CommitOptions) => Promise<{ kind: string }>;
  onFailure: (failure: unknown) => void;
}

export function CommitComposer({
  hasStagedFiles,
  outgoing,
  outgoingError,
  onCommit,
  onFailure,
}: CommitComposerProps) {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [amend, setAmend] = useState(false);
  const [signOff, setSignOff] = useState(false);
  const [committing, setCommitting] = useState(false);
  const subjectId = useId();
  const counterId = useId();
  const bodyId = useId();

  const selectedType = typeOf(subject);
  const hasSubject = subject.trim() !== "";
  const hasValidMessage = hasSubject || (amend && body.trim() === "");
  const canCommit = hasValidMessage && (amend || hasStagedFiles) && !committing;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setCommitting(true);
    try {
      const outcome = await onCommit(messageOf(subject, body), { amend, signOff });
      if (outcome.kind === "succeeded") {
        setSubject("");
        setBody("");
        setAmend(false);
      }
    } catch (failure) {
      onFailure(failure);
    } finally {
      setCommitting(false);
    }
  }

  return (
    <aside className="commit-dock">
      <form className="commit-composer" aria-label="Commit" onSubmit={submit}>
        <div className="type-chips" role="group" aria-label="Commit type">
          {COMMIT_TYPES.map((type) => (
            <button
              key={type}
              type="button"
              className="type-chip"
              aria-pressed={selectedType === type}
              onClick={() => setSubject(withType(subject, selectedType === type ? undefined : type))}
            >
              {type}
            </button>
          ))}
        </div>

        <div className="subject-line">
          <label htmlFor={subjectId}>Subject</label>
          <span
            id={counterId}
            className="subject-counter"
            data-over-limit={subject.length > SUBJECT_LIMIT}
          >
            {subject.length} / {SUBJECT_LIMIT}
          </span>
        </div>
        <input
          id={subjectId}
          type="text"
          value={subject}
          aria-describedby={counterId}
          placeholder={amend ? "Leave empty to keep the previous message" : undefined}
          onChange={(event) => setSubject(event.target.value)}
        />

        <label htmlFor={bodyId}>Body</label>
        <textarea
          id={bodyId}
          rows={5}
          value={body}
          onChange={(event) => setBody(event.target.value)}
        />

        <label className="option">
          <input type="checkbox" checked={amend} onChange={(e) => setAmend(e.target.checked)} />
          Amend previous commit
        </label>
        <label className="option">
          <input
            type="checkbox"
            checked={signOff}
            onChange={(event) => setSignOff(event.target.checked)}
          />
          Sign off
        </label>

        <button type="submit" disabled={!canCommit}>
          {amend ? "Amend commit" : "Commit"}
        </button>
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
