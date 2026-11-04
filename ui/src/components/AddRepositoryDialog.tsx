import { type FormEvent, useEffect, useId, useState } from "react";

import type { CoreApi, FoundRepository, Group } from "../core/api";
import { describeError } from "../core/describeError";
import { Button } from "./Button";
import { Select, TextInput } from "./FormControls";

export type AddKind = "clone" | "init" | "scan";

interface AddRepositoryDialogProps {
  api: CoreApi;
  kind: AddKind;
  pickFolder: () => Promise<string | null>;
  onClose: () => void;
  /** Called once something was added, so lists showing Repositories can read them again. */
  onAdded: () => void;
  /** For failures that happen after the dialog has closed. */
  onFailure: (message: string) => void;
}

const titles: Record<AddKind, string> = {
  clone: "Clone a Repository",
  init: "Initialize a Repository",
  scan: "Scan a folder for Repositories",
};

export function AddRepositoryDialog({
  api,
  kind,
  pickFolder,
  onClose,
  onAdded,
  onFailure,
}: AddRepositoryDialogProps) {
  const titleId = useId();
  const [groups, setGroups] = useState<Group[]>([]);
  const [groupId, setGroupId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let current = true;
    api.listRepositories().then(
      (list) => current && setGroups(list.groups),
      () => {
        // Adding still works without choosing a Group.
      },
    );
    return () => {
      current = false;
    };
  }, [api]);

  const chosenGroup = groupId === "" ? null : groupId;

  async function attempt(action: () => Promise<unknown>) {
    setError(null);
    setBusy(true);
    try {
      await action();
      onAdded();
      onClose();
    } catch (failure) {
      setError(describeError(failure));
      setBusy(false);
    }
  }

  const shared = { pickFolder, groups, groupId, onGroupChange: setGroupId, busy, onCancel: onClose };

  return (
    <div className="dialog-backdrop">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="dialog"
        onKeyDown={(event) => event.key === "Escape" && !busy && onClose()}
      >
        <h2 id={titleId}>{titles[kind]}</h2>
        {kind === "clone" && (
          <CloneForm
            {...shared}
            onSubmit={(url, parent) => {
              // A clone can take long and has its own progress and Cancel in the output panel,
              // so the dialog does not wait for it.
              onClose();
              api.cloneRepository(url, parent, chosenGroup).then(onAdded, (failure) =>
                onFailure(describeError(failure)),
              );
            }}
          />
        )}
        {kind === "init" && (
          <InitForm
            {...shared}
            onSubmit={(folder) => attempt(() => api.initRepository(folder, chosenGroup))}
          />
        )}
        {kind === "scan" && (
          <ScanForm
            {...shared}
            api={api}
            onError={setError}
            onImport={(paths) => attempt(() => api.importRepositories(paths, chosenGroup))}
          />
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

interface FormProps {
  pickFolder: () => Promise<string | null>;
  groups: Group[];
  groupId: string;
  onGroupChange: (id: string) => void;
  busy: boolean;
  onCancel: () => void;
}

function CloneForm({
  pickFolder,
  groups,
  groupId,
  onGroupChange,
  busy,
  onCancel,
  onSubmit,
}: FormProps & { onSubmit: (url: string, parent: string) => void }) {
  const [url, setUrl] = useState("");
  const [parent, setParent] = useState<string | null>(null);
  const urlId = useId();
  const canSubmit = url.trim() !== "" && parent !== null && !busy;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (canSubmit) onSubmit(url, parent);
  }

  return (
    <form className="add-form" onSubmit={submit}>
      <label htmlFor={urlId}>Repository URL</label>
      <TextInput id={urlId} value={url} onChange={(event) => setUrl(event.target.value)} autoFocus />
      <FolderField label="Clone into" folder={parent} pickFolder={pickFolder} onPick={setParent} />
      <GroupField groups={groups} groupId={groupId} onChange={onGroupChange} />
      <FormActions submitLabel="Clone" canSubmit={canSubmit} onCancel={onCancel} />
    </form>
  );
}

function InitForm({
  pickFolder,
  groups,
  groupId,
  onGroupChange,
  busy,
  onCancel,
  onSubmit,
}: FormProps & { onSubmit: (folder: string) => void }) {
  const [folder, setFolder] = useState<string | null>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (folder !== null && !busy) onSubmit(folder);
  }

  return (
    <form className="add-form" onSubmit={submit}>
      <FolderField label="Folder" folder={folder} pickFolder={pickFolder} onPick={setFolder} />
      <GroupField groups={groups} groupId={groupId} onChange={onGroupChange} />
      <FormActions submitLabel="Initialize" canSubmit={folder !== null && !busy} onCancel={onCancel} />
    </form>
  );
}

function ScanForm({
  api,
  pickFolder,
  groups,
  groupId,
  onGroupChange,
  busy,
  onCancel,
  onError,
  onImport,
}: FormProps & {
  api: CoreApi;
  onError: (message: string | null) => void;
  onImport: (paths: string[]) => void;
}) {
  const [folder, setFolder] = useState<string | null>(null);
  const [found, setFound] = useState<FoundRepository[] | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());

  async function scan(parent: string) {
    setFolder(parent);
    onError(null);
    try {
      const results = await api.scanFolder(parent);
      setFound(results);
      setSelected(new Set(results.filter((repo) => !repo.alreadyAdded).map((repo) => repo.path)));
    } catch (failure) {
      setFound(null);
      onError(describeError(failure));
    }
  }

  function toggle(path: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (!next.delete(path)) next.add(path);
      return next;
    });
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (selected.size > 0 && !busy) onImport([...selected]);
  }

  return (
    <form className="add-form" onSubmit={submit}>
      <FolderField label="Folder to scan" folder={folder} pickFolder={pickFolder} onPick={scan} />
      {found !== null &&
        (found.length === 0 ? (
          <p className="placeholder">No Repositories found in that folder.</p>
        ) : (
          <ul className="found-repositories" aria-label="Repositories found">
            {found.map((repo) => (
              <li key={repo.path}>
                <label>
                  <input
                    type="checkbox"
                    checked={selected.has(repo.path)}
                    disabled={repo.alreadyAdded}
                    onChange={() => toggle(repo.path)}
                  />
                  <span className="found-name">{repo.name}</span>
                  <span className="found-path">{repo.path}</span>
                  {repo.alreadyAdded && <span className="found-note">already added</span>}
                </label>
              </li>
            ))}
          </ul>
        ))}
      <GroupField groups={groups} groupId={groupId} onChange={onGroupChange} />
      <FormActions
        submitLabel="Import selected"
        canSubmit={selected.size > 0 && !busy}
        onCancel={onCancel}
      />
    </form>
  );
}

function FolderField({
  label,
  folder,
  pickFolder,
  onPick,
}: {
  label: string;
  folder: string | null;
  pickFolder: () => Promise<string | null>;
  onPick: (folder: string) => void;
}) {
  return (
    <div className="folder-field">
      <span>{label}</span>
      <span className="folder-path">{folder ?? "No folder chosen"}</span>
      <Button
        type="button" size="sm"
        onClick={async () => {
          const picked = await pickFolder();
          if (picked !== null) onPick(picked);
        }}
      >
        Choose folder…
      </Button>
    </div>
  );
}

function GroupField({
  groups,
  groupId,
  onChange,
}: {
  groups: Group[];
  groupId: string;
  onChange: (id: string) => void;
}) {
  const id = useId();
  if (groups.length === 0) return null;
  return (
    <>
      <label htmlFor={id}>Group</label>
      <Select id={id} value={groupId} onChange={(event) => onChange(event.target.value)}>
        <option value="">No group</option>
        {groups.map((group) => (
          <option key={group.id} value={group.id}>
            {group.name}
          </option>
        ))}
      </Select>
    </>
  );
}

function FormActions({
  submitLabel,
  canSubmit,
  onCancel,
}: {
  submitLabel: string;
  canSubmit: boolean;
  onCancel: () => void;
}) {
  return (
    <div className="dialog-actions">
      <Button type="button" onClick={onCancel}>
        Cancel
      </Button>
      <Button variant="primary" type="submit" disabled={!canSubmit}>
        {submitLabel}
      </Button>
    </div>
  );
}
