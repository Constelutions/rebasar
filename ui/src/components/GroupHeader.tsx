import { useState, type FormEvent } from "react";

import type { Group } from "../core/api";

interface GroupHeaderProps {
  group: Group;
  count: number;
  isFirst: boolean;
  isLast: boolean;
  onRename: (name: string) => Promise<boolean>;
  onMove: (offset: -1 | 1) => void;
}

export function GroupHeader({ group, count, isFirst, isLast, onRename, onMove }: GroupHeaderProps) {
  const [renaming, setRenaming] = useState(false);

  async function rename(name: string) {
    if (await onRename(name)) setRenaming(false);
  }

  return (
    <header className="group-header">
      {renaming ? (
        <GroupNameForm
          initialName={group.name}
          submitLabel="Rename"
          onSubmit={rename}
          onCancel={() => setRenaming(false)}
        />
      ) : (
        <>
          <h2>{group.name}</h2>
          <span className="group-count">{count}</span>
          <div className="group-actions">
            <button
              type="button"
              className="text-button"
              aria-label={`Rename ${group.name}`}
              onClick={() => setRenaming(true)}
            >
              Rename
            </button>
            <button
              type="button"
              className="text-button"
              aria-label={`Move ${group.name} up`}
              disabled={isFirst}
              onClick={() => onMove(-1)}
            >
              ↑
            </button>
            <button
              type="button"
              className="text-button"
              aria-label={`Move ${group.name} down`}
              disabled={isLast}
              onClick={() => onMove(1)}
            >
              ↓
            </button>
          </div>
        </>
      )}
    </header>
  );
}

interface GroupNameFormProps {
  initialName: string;
  submitLabel: string;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}

export function GroupNameForm({ initialName, submitLabel, onSubmit, onCancel }: GroupNameFormProps) {
  const [name, setName] = useState(initialName);

  function submit(event: FormEvent) {
    event.preventDefault();
    onSubmit(name);
  }

  return (
    <form className="group-name-form" onSubmit={submit}>
      <input
        type="text"
        autoFocus
        aria-label="Group name"
        value={name}
        className="group-name-input"
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") onCancel();
        }}
      />
      <button type="submit" className="text-button">
        {submitLabel}
      </button>
      <button type="button" className="text-button" onClick={onCancel}>
        Cancel
      </button>
    </form>
  );
}
