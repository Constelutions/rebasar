import { type FormEvent, useCallback, useEffect, useId, useState } from "react";

import type { CoreApi, MutationOutcome, RemoteInfo, TagInfo } from "../core/api";
import { describeError } from "../core/describeError";
import { useConfirmation } from "../useConfirmation";
import { ActionMenu, type MenuItem, OptionsButton, useActionMenu } from "./ActionMenu";
import { Button } from "./Button";
import { TruncatedText } from "./TruncatedText";

interface SectionProps {
  api: CoreApi;
  worktreePath: string;
  onError: (message: string | null) => void;
}

/** Loads a list again whenever the Worktree changes, which includes what these sections run. */
function useList<T>(load: () => Promise<T[]>, api: CoreApi, worktreePath: string, onError: (m: string) => void) {
  const [items, setItems] = useState<T[]>([]);
  const reload = useCallback(async () => {
    try {
      setItems(await load());
    } catch (failure) {
      onError(describeError(failure));
    }
    // `load` closes over the same api and path.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, worktreePath]);

  useEffect(() => {
    void reload();
    const subscription = api.onEvent((event) => {
      if (event.type === "worktreeChanged" && event.worktreePath === worktreePath) void reload();
    });
    return () => {
      void subscription.then((unsubscribe) => unsubscribe());
    };
  }, [api, worktreePath, reload]);
  return { items, reload };
}

async function report(
  title: string,
  action: () => Promise<MutationOutcome>,
  onError: (message: string | null) => void,
) {
  onError(null);
  try {
    const outcome = await action();
    if (outcome.kind === "failed") onError(`${title} failed. Details are in the output panel.`);
  } catch (failure) {
    onError(describeError(failure));
  }
}

export function TagsSection({ api, worktreePath, onError }: SectionProps) {
  const { items: tags, reload } = useList<TagInfo>(() => api.listTags(worktreePath), api, worktreePath, onError);
  const { items: remotes } = useList<RemoteInfo>(() => api.listRemotes(worktreePath), api, worktreePath, onError);
  const { confirm, dialog } = useConfirmation(api, worktreePath);
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const nameId = useId();
  const messageId = useId();
  const remote = remotes.find((candidate) => candidate.name === "origin") ?? remotes[0];

  async function create(event: FormEvent) {
    event.preventDefault();
    if (name.trim() === "") return;
    await report(
      `Creating tag ${name.trim()}`,
      () => api.createTagHere(worktreePath, name.trim(), message.trim() === "" ? null : message.trim()),
      onError,
    );
    setName("");
    setMessage("");
    await reload();
  }

  return (
    <section aria-label="Tags" className="branch-section">
      <h2>Tags</h2>
      <form className="new-branch" aria-label="New tag" onSubmit={create}>
        <label htmlFor={nameId}>Tag name</label>
        <input id={nameId} value={name} onChange={(event) => setName(event.target.value)} />
        <label htmlFor={messageId}>Message (makes it annotated)</label>
        <input id={messageId} value={message} onChange={(event) => setMessage(event.target.value)} />
        <Button variant="primary" type="submit" disabled={name.trim() === ""}>
          Create tag
        </Button>
      </form>
      {tags.length === 0 ? (
        <p className="placeholder">No tags.</p>
      ) : (
        <ul className="branch-list" aria-label="Tag list">
          {tags.map((tag) => (
            <TagRow
              key={tag.name}
              tag={tag}
              remote={remote}
              onPush={(remoteName) =>
                void report(`Pushing ${tag.name}`, () => api.pushTag(worktreePath, tag.name, remoteName), onError)
              }
              onDeleteOnRemote={(remoteName) =>
                void confirm({ kind: "deleteRemoteTag", name: tag.name, remote: remoteName }, () =>
                  void report(
                    `Deleting ${tag.name} on ${remoteName}`,
                    () => api.deleteRemoteTag(worktreePath, tag.name, remoteName),
                    onError,
                  ),
                ).catch((failure) => onError(describeError(failure)))
              }
              onDelete={() =>
                void confirm({ kind: "deleteTag", name: tag.name }, () =>
                  void report(`Deleting ${tag.name}`, () => api.deleteTag(worktreePath, tag.name), onError).then(reload),
                ).catch((failure) => onError(describeError(failure)))
              }
            />
          ))}
        </ul>
      )}
      {dialog}
    </section>
  );
}

export function RemotesSection({ api, worktreePath, onError }: SectionProps) {
  const { items: remotes, reload } = useList<RemoteInfo>(
    () => api.listRemotes(worktreePath),
    api,
    worktreePath,
    onError,
  );
  const [editing, setEditing] = useState<{ remote: RemoteInfo; field: "name" | "url" } | null>(null);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const nameId = useId();
  const urlId = useId();

  async function add(event: FormEvent) {
    event.preventDefault();
    if (name.trim() === "" || url.trim() === "") return;
    await report(`Adding ${name.trim()}`, () => api.addRemote(worktreePath, name.trim(), url.trim()), onError);
    setName("");
    setUrl("");
    await reload();
  }

  return (
    <section aria-label="Remotes" className="branch-section">
      <h2>Remotes</h2>
      <form className="new-branch" aria-label="New remote" onSubmit={add}>
        <label htmlFor={nameId}>Remote name</label>
        <input id={nameId} value={name} onChange={(event) => setName(event.target.value)} />
        <label htmlFor={urlId}>Address</label>
        <input id={urlId} value={url} onChange={(event) => setUrl(event.target.value)} />
        <Button variant="primary" type="submit" disabled={name.trim() === "" || url.trim() === ""}>
          Add remote
        </Button>
      </form>
      {remotes.length === 0 ? (
        <p className="placeholder">No remotes.</p>
      ) : (
        <ul className="branch-list" aria-label="Remote list">
          {remotes.map((remote) => (
            <RemoteRow
              key={remote.name}
              remote={remote}
              onRename={() => setEditing({ remote, field: "name" })}
              onEditAddress={() => setEditing({ remote, field: "url" })}
              onRemove={() =>
                void report(`Removing ${remote.name}`, () => api.removeRemote(worktreePath, remote.name), onError).then(reload)
              }
            />
          ))}
        </ul>
      )}
      {editing && (
        <RemoteEditDialog
          editing={editing}
          onCancel={() => setEditing(null)}
          onSubmit={(value) => {
            const { remote, field } = editing;
            setEditing(null);
            void report(
              field === "name" ? `Renaming ${remote.name}` : `Editing ${remote.name}`,
              () =>
                field === "name"
                  ? api.renameRemote(worktreePath, remote.name, value)
                  : api.setRemoteUrl(worktreePath, remote.name, value),
              onError,
            ).then(reload);
          }}
        />
      )}
    </section>
  );
}

function RemoteEditDialog({
  editing,
  onSubmit,
  onCancel,
}: {
  editing: { remote: RemoteInfo; field: "name" | "url" };
  onSubmit: (value: string) => void;
  onCancel: () => void;
}) {
  const titleId = useId();
  const inputId = useId();
  const { remote, field } = editing;
  const [value, setValue] = useState(field === "name" ? remote.name : remote.url);
  const label = field === "name" ? "New name" : "New address";

  return (
    <div className="dialog-backdrop">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="dialog"
        onKeyDown={(event) => event.key === "Escape" && onCancel()}
      >
        <h2 id={titleId}>{field === "name" ? `Rename ${remote.name}` : `Address of ${remote.name}`}</h2>
        <form
          className="add-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (value.trim() !== "") onSubmit(value.trim());
          }}
        >
          <label htmlFor={inputId}>{label}</label>
          <input id={inputId} value={value} onChange={(event) => setValue(event.target.value)} autoFocus />
          <div className="dialog-actions">
            <Button type="button" onClick={onCancel}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" disabled={value.trim() === ""}>
              Save
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface TagRowProps {
  tag: TagInfo;
  remote: RemoteInfo | undefined;
  onPush: (remote: string) => void;
  onDeleteOnRemote: (remote: string) => void;
  onDelete: () => void;
}

/** Push stays on the row; the deletions wait in its menu. Without a remote there is only Delete, which stays inline. */
function TagRow({ tag, remote, onPush, onDeleteOnRemote, onDelete }: TagRowProps) {
  const menu = useActionMenu();
  const items: MenuItem[] = remote
    ? [
        {
          key: "delete-remote",
          label: `Delete on ${remote.name}`,
          destructive: true,
          run: () => onDeleteOnRemote(remote.name),
        },
        { key: "delete", label: "Delete", destructive: true, run: onDelete },
      ]
    : [];

  return (
    <li className="branch-row" onContextMenu={items.length > 0 ? menu.openFromContextMenu : undefined}>
      <TruncatedText className="branch-name" text={tag.name} />
      <span className="branch-badge">{tag.annotated ? "annotated" : "lightweight"}</span>
      <TruncatedText className="branch-upstream" text={`${tag.shortId} ${tag.subject}`} />
      <span className="branch-actions">
        {remote ? (
          <>
            <Button
              size="sm"
              type="button"
              aria-label={`Push tag ${tag.name} to ${remote.name}`}
              onClick={() => onPush(remote.name)}
            >
              Push
            </Button>
            <OptionsButton label={`Options for tag ${tag.name}`} expanded={menu.open !== null} onClick={menu.openFromButton} />
          </>
        ) : (
          <Button size="sm" type="button" variant="danger" aria-label={`Delete tag ${tag.name}`} onClick={onDelete}>
            Delete
          </Button>
        )}
      </span>
      {menu.open && (
        <ActionMenu
          label={`Actions for tag ${tag.name}`}
          items={items}
          x={menu.open.x}
          y={menu.open.y}
          onClose={menu.close}
        />
      )}
    </li>
  );
}

interface RemoteRowProps {
  remote: RemoteInfo;
  onRename: () => void;
  onEditAddress: () => void;
  onRemove: () => void;
}

function RemoteRow({ remote, onRename, onEditAddress, onRemove }: RemoteRowProps) {
  const menu = useActionMenu();
  const items: MenuItem[] = [
    { key: "rename", label: "Rename", run: onRename },
    { key: "address", label: "Edit address", run: onEditAddress },
    { key: "remove", label: "Remove", destructive: true, separated: true, run: onRemove },
  ];

  return (
    <li className="branch-row" onContextMenu={menu.openFromContextMenu}>
      <TruncatedText className="branch-name" text={remote.name} />
      <TruncatedText className="branch-upstream" text={remote.url} />
      {remote.pushUrl && <TruncatedText className="branch-upstream" text={`push: ${remote.pushUrl}`} />}
      <span className="branch-actions">
        <OptionsButton label={`Options for remote ${remote.name}`} expanded={menu.open !== null} onClick={menu.openFromButton} />
      </span>
      {menu.open && (
        <ActionMenu
          label={`Actions for remote ${remote.name}`}
          items={items}
          x={menu.open.x}
          y={menu.open.y}
          onClose={menu.close}
        />
      )}
    </li>
  );
}
