import { useCallback, useEffect, useState } from "react";

import type { CoreApi, RepositoryEntry, RepositoryList } from "../core/api";
import { describeError } from "../core/describeError";
import type { AddKind } from "./AddRepositoryDialog";
import { Button } from "./Button";
import { FixedTab, GroupNameForm, GroupTab } from "./GroupTabs";
import { RepositoryRow } from "./RepositoryRow";

interface RepositoriesViewProps {
  api: CoreApi;
  pickFolder: () => Promise<string | null>;
  onAdd: (kind: AddKind) => void;
  /** Reading starts again whenever it changes. */
  version: number;
}

type Selection = "all" | "ungrouped" | { group: string };

export function RepositoriesView({ api, pickFolder, onAdd, version }: RepositoriesViewProps) {
  const [list, setList] = useState<RepositoryList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [selection, setSelection] = useState<Selection>("all");
  const [renaming, setRenaming] = useState<string | null>(null);

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
  const current: Selection =
    selection === "ungrouped" && (ungrouped.length === 0 || groups.length === 0)
      ? "all"
      : typeof selection === "object" && !groups.some((group) => group.id === selection.group)
        ? "all"
        : selection;
  const shown =
    current === "all"
      ? repositories
      : current === "ungrouped"
        ? ungrouped
        : repositories.filter((repository) => repository.groupId === current.group);
  const panelLabel =
    current === "all"
      ? "All"
      : current === "ungrouped"
        ? "Ungrouped"
        : (groups.find((group) => group.id === current.group)?.name ?? "All");
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
          Initialize…
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
      {(repositories.length > 0 || groups.length > 0) && (
        <>
          <div role="tablist" aria-label="Groups" className="group-tabs">
            <FixedTab
              label="All"
              count={repositories.length}
              selected={current === "all"}
              onSelect={() => setSelection("all")}
            />
            {groups.map((group, index) =>
              renaming === group.id ? (
                <GroupNameForm
                  key={group.id}
                  initialName={group.name}
                  submitLabel="Rename"
                  onSubmit={async (name) => {
                    if (await run(() => api.renameGroup(group.id, name))) setRenaming(null);
                  }}
                  onCancel={() => setRenaming(null)}
                />
              ) : (
                <GroupTab
                  key={group.id}
                  group={group}
                  count={repositories.filter((repository) => repository.groupId === group.id).length}
                  selected={typeof current === "object" && current.group === group.id}
                  isFirst={index === 0}
                  isLast={index === groups.length - 1}
                  onSelect={() => setSelection({ group: group.id })}
                  onRename={() => setRenaming(group.id)}
                  onMove={(offset) => void run(() => api.moveGroup(group.id, index + offset))}
                />
              ),
            )}
            {ungrouped.length > 0 && groups.length > 0 && (
              <FixedTab
                label="Ungrouped"
                count={ungrouped.length}
                selected={current === "ungrouped"}
                onSelect={() => setSelection("ungrouped")}
              />
            )}
          </div>
          <div role="tabpanel" aria-label={panelLabel} className="repository-group">
            {shown.length === 0 ? (
              <p className="placeholder">No Repositories here.</p>
            ) : (
              <RepositoryItems repositories={shown} {...rowActions} />
            )}
          </div>
        </>
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
