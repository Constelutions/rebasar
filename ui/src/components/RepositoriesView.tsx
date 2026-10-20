import { useCallback, useEffect, useState } from "react";

import type { CoreApi, RepositoryEntry, RepositoryList } from "../core/api";
import { describeError } from "../core/describeError";
import type { AddKind } from "./AddRepositoryDialog";
import { Button } from "./Button";
import { GroupHeader, GroupNameForm } from "./GroupHeader";
import { RepositoryRow } from "./RepositoryRow";

interface RepositoriesViewProps {
  api: CoreApi;
  pickFolder: () => Promise<string | null>;
  onAdd: (kind: AddKind) => void;
  /** Reading starts again whenever it changes. */
  version: number;
}

export function RepositoriesView({ api, pickFolder, onAdd, version }: RepositoriesViewProps) {
  const [list, setList] = useState<RepositoryList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const reload = useCallback(async () => {
    setList(await api.listRepositories());
  }, [api]);

  useEffect(() => {
    reload().catch((failure) => setError(describeError(failure)));
  }, [reload, version]);

  // Worktrees created or removed from the Worktrees view, or in a terminal, show up here too.
  useEffect(() => {
    const subscription = api.onEvent((event) => {
      if (event.type === "worktreeChanged") {
        reload().catch((failure) => setError(describeError(failure)));
      }
    });
    return () => {
      void subscription.then((unsubscribe) => unsubscribe());
    };
  }, [api, reload]);

  async function run(action: () => Promise<unknown>): Promise<boolean> {
    setError(null);
    try {
      await action();
      await reload();
      return true;
    } catch (failure) {
      setError(describeError(failure));
      return false;
    }
  }

  async function locate(repository: RepositoryEntry) {
    const folder = await pickFolder();
    if (folder === null) return;
    await run(() => api.locateRepository(repository.path, folder));
  }

  async function createGroup(name: string) {
    if (await run(() => api.createGroup(name))) setCreating(false);
  }

  if (!list) return null;

  const { groups, repositories } = list;
  const ungrouped = repositories.filter((repository) => repository.groupId === null);
  const rowActions = {
    groups,
    onMove: (repository: RepositoryEntry, groupId: string | null) =>
      run(() => api.moveRepository(repository.path, groupId)),
    onLocate: locate,
    onRemove: (repository: RepositoryEntry) => run(() => api.removeRepository(repository.path)),
  };

  return (
    <div className="repositories">
      <div className="repositories-toolbar">
        <Button type="button" size="sm" onClick={() => onAdd("clone")}>
          Clone…
        </Button>
        <Button type="button" size="sm" onClick={() => onAdd("init")}>
          Initialise…
        </Button>
        <Button type="button" size="sm" onClick={() => onAdd("scan")}>
          Scan folder…
        </Button>
        {creating ? (
          <GroupNameForm
            initialName=""
            submitLabel="Create"
            onSubmit={createGroup}
            onCancel={() => setCreating(false)}
          />
        ) : (
          <Button type="button" size="sm" onClick={() => setCreating(true)}>
            New group
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {repositories.length === 0 && groups.length === 0 && (
        <p className="placeholder">No Repositories yet. Open a folder to add one.</p>
      )}
      {groups.map((group, index) => {
        const members = repositories.filter((repository) => repository.groupId === group.id);
        return (
          <section key={group.id} aria-label={group.name} className="repository-group">
            <GroupHeader
              group={group}
              count={members.length}
              isFirst={index === 0}
              isLast={index === groups.length - 1}
              onRename={(name) => run(() => api.renameGroup(group.id, name))}
              onMove={(offset) => run(() => api.moveGroup(group.id, index + offset))}
            />
            <RepositoryItems repositories={members} {...rowActions} />
          </section>
        );
      })}
      {(ungrouped.length > 0 || groups.length > 0) && (
        <section aria-label="Ungrouped" className="repository-group">
          <header className="group-header">
            <h2>Ungrouped</h2>
            <span className="group-count">{ungrouped.length}</span>
          </header>
          <RepositoryItems repositories={ungrouped} {...rowActions} />
        </section>
      )}
    </div>
  );
}

interface RepositoryItemsProps {
  repositories: RepositoryEntry[];
  groups: RepositoryList["groups"];
  onMove: (repository: RepositoryEntry, groupId: string | null) => void;
  onLocate: (repository: RepositoryEntry) => void;
  onRemove: (repository: RepositoryEntry) => void;
}

function RepositoryItems({ repositories, ...actions }: RepositoryItemsProps) {
  return (
    <ul className="repository-list">
      {repositories.map((repository) => (
        <RepositoryRow key={repository.path} repository={repository} {...actions} />
      ))}
    </ul>
  );
}
