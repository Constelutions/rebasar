import { useEffect, useId, useMemo, useState } from "react";

import type { CoreApi, PlanAction, RebasePlan, RebasePlanEntry } from "../core/api";
import { describeError } from "../core/describeError";
import { Button } from "./Button";
import { Select, TextArea } from "./FormControls";

type CommitEntry = Extract<RebasePlanEntry, { kind: "commit" }>;

const choices: { action: PlanAction; label: string }[] = [
  { action: "pick", label: "Pick" },
  { action: "reword", label: "Reword" },
  { action: "squash", label: "Squash" },
  { action: "fixup", label: "Fixup" },
  { action: "drop", label: "Drop" },
];

interface RebaseEditorProps {
  api: CoreApi;
  worktreePath: string;
  /** The commit the rebase starts at; `null` edits the rebase already in progress. */
  from: string | null;
  onClose: () => void;
}

export function RebaseEditor({ api, worktreePath, from, onClose }: RebaseEditorProps) {
  const titleId = useId();
  const [plan, setPlan] = useState<RebasePlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragged, setDragged] = useState<number | null>(null);

  useEffect(() => {
    let current = true;
    api.rebasePlan(worktreePath, from).then(
      (loaded) => current && setPlan(loaded),
      (failure) => current && setError(describeError(failure)),
    );
    return () => {
      current = false;
    };
  }, [api, worktreePath, from]);

  const entries = plan?.entries ?? [];
  const movable = useMemo(
    () =>
      entries.flatMap((entry, index) =>
        entry.kind === "commit" && entry.action !== "edit" ? [index] : [],
      ),
    [entries],
  );
  const firstCommit = entries.find(
    (entry): entry is CommitEntry => entry.kind === "commit" && entry.action !== "drop",
  );
  const startsWithFold = firstCommit?.action === "squash" || firstCommit?.action === "fixup";
  const emptyReword = entries.some(
    (entry) => entry.kind === "commit" && entry.action === "reword" && entry.message.trim() === "",
  );

  function update(next: RebasePlanEntry[]) {
    setPlan((current) => current && { ...current, entries: next });
  }

  function change(index: number, patch: Partial<CommitEntry>) {
    update(
      entries.map((entry, position) =>
        position === index && entry.kind === "commit" ? { ...entry, ...patch } : entry,
      ),
    );
  }

  /** Read-only entries stay where they are; the others trade places among their slots. */
  function swap(slotA: number, slotB: number) {
    const [a, b] = [movable[slotA], movable[slotB]];
    if (a === undefined || b === undefined) return;
    const next = [...entries];
    [next[a], next[b]] = [entries[b] as RebasePlanEntry, entries[a] as RebasePlanEntry];
    update(next);
  }

  function move(index: number, offset: -1 | 1) {
    const slot = movable.indexOf(index);
    swap(slot, slot + offset);
  }

  function dropOn(index: number) {
    if (dragged === null) return;
    const from = movable.indexOf(dragged);
    const to = movable.indexOf(index);
    setDragged(null);
    if (from < 0 || to < 0 || from === to) return;
    const order = movable.map((position) => entries[position] as RebasePlanEntry);
    const [moved] = order.splice(from, 1);
    order.splice(to, 0, moved as RebasePlanEntry);
    const next = [...entries];
    movable.forEach((position, slot) => {
      next[position] = order[slot] as RebasePlanEntry;
    });
    update(next);
  }

  async function start() {
    if (!plan) return;
    setBusy(true);
    setError(null);
    try {
      const outcome = await api.applyRebasePlan(worktreePath, plan);
      if (outcome.kind === "succeeded") return onClose();
      const paused = await api.operationInProgress(worktreePath);
      if (paused) return onClose();
      setError("The rebase failed. Details are in the output panel.");
    } catch (failure) {
      setError(describeError(failure));
    }
    setBusy(false);
  }

  return (
    <div className="dialog-backdrop">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="dialog rebase-editor"
        onKeyDown={(event) => event.key === "Escape" && !busy && onClose()}
      >
        <h2 id={titleId}>Interactive rebase</h2>
        {plan && (
          <p className="settings-hint">
            Commits are replayed from the top down. Rebasar runs the plan through Git without an
            editor.
          </p>
        )}
        <ol className="rebase-plan" aria-label="Rebase plan">
          {entries.map((entry, index) =>
            entry.kind === "line" ? (
              <li key={`line-${index}`} className="rebase-line">
                <code>{entry.text}</code>
                <span className="settings-hint">read-only</span>
              </li>
            ) : (
              <CommitRow
                key={entry.commit}
                entry={entry}
                canMoveUp={movable.indexOf(index) > 0}
                canMoveDown={movable.indexOf(index) < movable.length - 1}
                onAction={(action) => change(index, { action })}
                onMessage={(message) => change(index, { message })}
                onMove={(offset) => move(index, offset)}
                onDragStart={() => setDragged(index)}
                onDrop={() => dropOn(index)}
              />
            ),
          )}
        </ol>
        {startsWithFold && (
          <p role="alert" className="error">
            The first commit cannot be squashed or fixed up: there is nothing before it.
          </p>
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
          <Button
            type="button"
            disabled={!plan || busy || startsWithFold || emptyReword}
            onClick={() => void start()}
          >
            {plan?.inProgress ? "Update plan" : "Start rebase"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function CommitRow({
  entry,
  canMoveUp,
  canMoveDown,
  onAction,
  onMessage,
  onMove,
  onDragStart,
  onDrop,
}: {
  entry: CommitEntry;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onAction: (action: PlanAction) => void;
  onMessage: (message: string) => void;
  onMove: (offset: -1 | 1) => void;
  onDragStart: () => void;
  onDrop: () => void;
}) {
  const readOnly = entry.action === "edit";

  return (
    <li
      className="rebase-commit"
      draggable={!readOnly}
      onDragStart={onDragStart}
      onDragOver={(event) => event.preventDefault()}
      onDrop={onDrop}
      data-action={entry.action}
    >
      <Select
        aria-label={`Action for ${entry.shortId}`}
        value={entry.action}
        disabled={readOnly}
        onChange={(event) => onAction(event.target.value as PlanAction)}
      >
        {readOnly && <option value="edit">Edit (read-only)</option>}
        {choices.map(({ action, label }) => (
          <option key={action} value={action}>
            {label}
          </option>
        ))}
      </Select>
      <span className="commit-hash">{entry.shortId}</span>
      <span className="commit-subject">{entry.subject}</span>
      {!readOnly && (
        <span className="rebase-moves">
          <Button
            size="sm"
            type="button"
            aria-label={`Move ${entry.shortId} up`}
            disabled={!canMoveUp}
            onClick={() => onMove(-1)}
          >
            ↑
          </Button>
          <Button
            size="sm"
            type="button"
            aria-label={`Move ${entry.shortId} down`}
            disabled={!canMoveDown}
            onClick={() => onMove(1)}
          >
            ↓
          </Button>
        </span>
      )}
      {entry.action === "reword" && (
        <TextArea
          aria-label={`Message for ${entry.shortId}`}
          rows={4}
          value={entry.message}
          onChange={(event) => onMessage(event.target.value)}
        />
      )}
    </li>
  );
}
