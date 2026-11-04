import { type FormEvent, useCallback, useEffect, useId, useMemo, useState } from "react";

import type {
  CoreApi,
  DiffMode,
  FileChange,
  MutationOutcome,
  StashInfo,
  StashPreview,
  Tab,
} from "../core/api";
import { describeError } from "../core/describeError";
import { formatDateTime } from "../history/items";
import { useCommitFileDiff } from "../history/useCommitFileDiff";
import { useSettings } from "../settings/SettingsContext";
import { useConfirmation } from "../useConfirmation";
import { ActionMenu, type MenuItem, OptionsButton, useActionMenu } from "./ActionMenu";
import { Button } from "./Button";
import { buildGroupTrees, firstFile } from "./changeTree";
import { DiffView } from "./DiffView";
import { FileTree } from "./FileTree";
import { TextInput } from "./FormControls";
import { TruncatedText } from "./TruncatedText";

interface StashesViewProps {
  api: CoreApi;
  tab: Tab;
}

export function StashesView({ api, tab }: StashesViewProps) {
  const path = tab.worktreePath;
  const [stashes, setStashes] = useState<StashInfo[] | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { confirm, dialog } = useConfirmation(api, path);

  const reload = useCallback(async () => {
    try {
      setStashes(await api.listStashes(path));
    } catch (failure) {
      setError(describeError(failure));
    }
  }, [api, path]);

  useEffect(() => {
    void reload();
    const subscription = api.onEvent((event) => {
      if (event.type === "worktreeChanged" && event.worktreePath === path) void reload();
    });
    return () => {
      void subscription.then((unsubscribe) => unsubscribe());
    };
  }, [api, path, reload]);

  async function run(title: string, action: () => Promise<MutationOutcome>) {
    setError(null);
    try {
      const outcome = await action();
      if (outcome.kind === "failed") {
        setError(`${title} failed. If it stopped on a conflict, resolve it in the Conflicts view.`);
      }
    } catch (failure) {
      setError(describeError(failure));
    }
    await reload();
  }

  if (stashes === null) {
    return error ? (
      <p role="alert" className="error">
        {error}
      </p>
    ) : null;
  }

  const selected = stashes.find((stash) => stash.id === picked) ?? stashes[0];

  return (
    <div className="stashes">
      <CreateStashForm
        onCreate={(message, includeUntracked) =>
          run("Stash", () => api.stashChanges(path, message, includeUntracked))
        }
      />
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {stashes.length === 0 ? (
        <p className="placeholder">No stashes.</p>
      ) : (
        <div className="stash-layout">
          <ul className="stash-list" aria-label="Stashes">
            {stashes.map((stash) => (
              <StashRow
                key={stash.id}
                stash={stash}
                selected={stash.id === selected?.id}
                onShow={() => setPicked(stash.id)}
                onApply={() => void run("Apply", () => api.applyStash(path, stash.id))}
                onPop={() => void run("Pop", () => api.popStash(path, stash.id))}
                onDrop={() =>
                  void confirm({ kind: "dropStash", stash: stash.id }, () =>
                    void run("Drop", () => api.dropStash(path, stash.id)),
                  ).catch((failure) => setError(describeError(failure)))
                }
              />
            ))}
          </ul>
          {selected && (
            <StashPreviewPane key={selected.id} api={api} worktreePath={path} stash={selected} />
          )}
        </div>
      )}
      {dialog}
    </div>
  );
}

function CreateStashForm({
  onCreate,
}: {
  onCreate: (message: string | null, includeUntracked: boolean) => Promise<void>;
}) {
  const [message, setMessage] = useState("");
  const [includeUntracked, setIncludeUntracked] = useState(false);
  const messageId = useId();

  async function submit(event: FormEvent) {
    event.preventDefault();
    await onCreate(message.trim() === "" ? null : message.trim(), includeUntracked);
    setMessage("");
  }

  return (
    <form className="new-branch" aria-label="New stash" onSubmit={submit}>
      <label htmlFor={messageId}>Stash message</label>
      <TextInput id={messageId} value={message} onChange={(event) => setMessage(event.target.value)} />
      <label className="option">
        <input
          type="checkbox"
          checked={includeUntracked}
          onChange={(event) => setIncludeUntracked(event.target.checked)}
        />
        Include untracked files
      </label>
      <Button variant="primary" type="submit">Stash changes</Button>
    </form>
  );
}

interface StashRowProps {
  stash: StashInfo;
  selected: boolean;
  onShow: () => void;
  onApply: () => void;
  onPop: () => void;
  onDrop: () => void;
}

/** Apply stays on the row because it keeps the stash; Pop and Drop, which remove it, wait in the menu. */
function StashRow({ stash, selected, onShow, onApply, onPop, onDrop }: StashRowProps) {
  const menu = useActionMenu();
  const items: MenuItem[] = [
    { key: "pop", label: "Pop", run: onPop },
    { key: "drop", label: "Drop", destructive: true, separated: true, run: onDrop },
  ];

  return (
    <li aria-current={selected || undefined} onContextMenu={menu.openFromContextMenu}>
      <Button
        variant="plain"
        type="button"
        className="stash-select"
        onClick={onShow}
        aria-label={`Show stash ${stash.message}`}
      >
        <TruncatedText className="stash-message" text={stash.message} />
        <span className="stash-meta">
          {stash.branch && `${stash.branch} · `}
          <time dateTime={new Date(stash.timestamp * 1000).toISOString()}>{formatDateTime(stash.timestamp)}</time>
        </span>
      </Button>
      <span className="stash-actions">
        <Button size="sm" type="button" aria-label={`Apply ${stash.message}`} onClick={onApply}>
          Apply
        </Button>
        <OptionsButton
          label={`Options for ${stash.message}`}
          expanded={menu.open !== null}
          onClick={menu.openFromButton}
        />
      </span>
      {menu.open && (
        <ActionMenu
          label={`Actions for ${stash.message}`}
          items={items}
          x={menu.open.x}
          y={menu.open.y}
          onClose={menu.close}
        />
      )}
    </li>
  );
}

function StashPreviewPane({
  api,
  worktreePath,
  stash,
}: {
  api: CoreApi;
  worktreePath: string;
  stash: StashInfo;
}) {
  const [preview, setPreview] = useState<StashPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pickedPath, setPickedPath] = useState<string | null>(null);
  const { settings } = useSettings();
  const [pickedMode, setPickedMode] = useState<DiffMode | null>(null);
  const mode = pickedMode ?? settings.diff.defaultMode;

  useEffect(() => {
    let current = true;
    api.stashPreview(worktreePath, stash.id).then(
      (loaded) => current && setPreview(loaded),
      (failure) => current && setError(describeError(failure)),
    );
    return () => {
      current = false;
    };
  }, [api, worktreePath, stash.id]);

  const files = preview?.files ?? [];
  const trees = useMemo(
    () =>
      buildGroupTrees(
        files.length > 0 ? [{ list: "commit" as const, name: "Stashed files", changes: files }] : [],
      ),
    [files],
  );
  const selected: FileChange | null =
    files.find((file) => file.path === pickedPath) ?? firstFile(trees)?.change ?? null;
  const diff = useCommitFileDiff(api, worktreePath, stash.id, 0, selected);

  return (
    <section className="stash-preview" aria-label={`Stash ${stash.message}`}>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {preview && files.length === 0 && preview.untracked.length === 0 && (
        <p className="placeholder">This stash holds no files.</p>
      )}
      {files.length > 0 && (
        <div className="changes">
          <div className="changes-files">
            <FileTree
              trees={trees}
              selected={selected && { list: "commit", path: selected.path }}
              onSelect={(_, change) => setPickedPath(change.path)}
            />
          </div>
          <div className="changes-diff">
            {diff.error && (
              <p role="alert" className="error">
                {diff.error}
              </p>
            )}
            {diff.value && (
              <DiffView
                key={diff.value.path}
                diff={diff.value}
                mode={mode}
                onModeChange={setPickedMode}
                onLoadLarge={diff.loadLarge}
              />
            )}
          </div>
        </div>
      )}
      {preview && preview.untracked.length > 0 && (
        <section aria-label="Untracked files in this stash">
          <h3>Untracked files</h3>
          <ul>
            {preview.untracked.map((file) => (
              <li key={file}>{file}</li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}
