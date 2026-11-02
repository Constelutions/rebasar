import { type FormEvent, useState } from "react";

import type { Group } from "../core/api";
import { ActionMenu, type MenuItem, OptionsButton, useActionMenu } from "./ActionMenu";
import { Button } from "./Button";

interface GroupTabProps {
  group: Group;
  count: number;
  selected: boolean;
  isFirst: boolean;
  isLast: boolean;
  onSelect: () => void;
  onRename: () => void;
  onMove: (offset: -1 | 1) => void;
}

/** One tab per Group; Rename and the order live in its menu, opened by the options button or a right-click. */
export function GroupTab({ group, count, selected, isFirst, isLast, onSelect, onRename, onMove }: GroupTabProps) {
  const menu = useActionMenu();
  const items: MenuItem[] = [
    { key: "rename", label: "Rename", run: onRename },
    { key: "left", label: "Move left", disabled: isFirst, separated: true, run: () => onMove(-1) },
    { key: "right", label: "Move right", disabled: isLast, run: () => onMove(1) },
  ];

  return (
    <div className="group-tab" data-selected={selected} onContextMenu={menu.openFromContextMenu}>
      <Button variant="plain" role="tab" aria-selected={selected} className="group-tab-select" onClick={onSelect}>
        <span className="group-tab-name">{group.name}</span>
        <span className="group-count">{count}</span>
      </Button>
      {selected && (
        <OptionsButton label={`Options for ${group.name}`} expanded={menu.open !== null} onClick={menu.openFromButton} />
      )}
      {menu.open && (
        <ActionMenu
          label={`Actions for ${group.name}`}
          items={items}
          x={menu.open.x}
          y={menu.open.y}
          onClose={menu.close}
        />
      )}
    </div>
  );
}

interface FixedTabProps {
  label: string;
  count: number;
  selected: boolean;
  onSelect: () => void;
}

/** The All and Ungrouped tabs, which belong to no Group and have no menu. */
export function FixedTab({ label, count, selected, onSelect }: FixedTabProps) {
  return (
    <div className="group-tab" data-selected={selected}>
      <Button variant="plain" role="tab" aria-selected={selected} className="group-tab-select" onClick={onSelect}>
        <span className="group-tab-name">{label}</span>
        <span className="group-count">{count}</span>
      </Button>
    </div>
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
      <Button variant="primary" type="submit" size="sm">
        {submitLabel}
      </Button>
      <Button type="button" size="sm" onClick={onCancel}>
        Cancel
      </Button>
    </form>
  );
}
