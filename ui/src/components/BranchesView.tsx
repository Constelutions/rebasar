import { type FormEvent, useCallback, useEffect, useId, useState } from "react";

import type {
  BranchInfo,
  BranchesFilter,
  CoreApi,
  MergeMode,
  MutationOutcome,
  RemoteInfo,
  Tab,
} from "../core/api";
import { describeError } from "../core/describeError";
import { useSettings } from "../settings/SettingsContext";
import { useConfirmation } from "../useConfirmation";
import { ActionMenu, type MenuItem, OptionsButton, useActionMenu } from "./ActionMenu";
import { Button } from "./Button";
import { SegmentedControl } from "./SegmentedControl";
import { TruncatedText } from "./TruncatedText";
import { type BranchRow, buildBranchRows, detailsOf, filterBranchRows } from "./branchRows";
import { TextInput } from "./FormControls";

interface BranchesViewProps {
  api: CoreApi;
  tab: Tab;
}

const filterOptions = [
  { value: "local", label: "Local" },
  { value: "remote", label: "Remote" },
  { value: "both", label: "Both" },
] as const;

type Prompt =
  | { kind: "rename"; branch: BranchInfo }
  | { kind: "upstream"; branch: BranchInfo };

export function BranchesView(props: BranchesViewProps) {
  const { settings, ready } = useSettings();
  if (!ready) return null;
  return <LoadedBranches {...props} defaultFilter={settings.branches.filter} />;
}

function LoadedBranches({ api, tab, defaultFilter }: BranchesViewProps & { defaultFilter: BranchesFilter }) {
  const path = tab.worktreePath;
  const [branches, setBranches] = useState<BranchInfo[] | null>(null);
  const [remotes, setRemotes] = useState<RemoteInfo[]>([]);
  const [filter, setFilter] = useState(defaultFilter);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const { confirm, dialog } = useConfirmation(api, path);

  const reload = useCallback(async () => {
    try {
      const [loadedBranches, loadedRemotes] = await Promise.all([api.listBranchDetails(path), api.listRemotes(path)]);
      setBranches(loadedBranches);
      setRemotes(loadedRemotes);
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
      if (outcome.kind === "failed") setError(`${title} failed. Details are in the output panel.`);
    } catch (failure) {
      setError(describeError(failure));
    }
    await reload();
  }

  if (branches === null) {
    return error ? (
      <p role="alert" className="error">
        {error}
      </p>
    ) : null;
  }

  const current = branches.find((branch) => branch.current);
  const rows = filterBranchRows(
    buildBranchRows(
      branches,
      remotes.map((remote) => remote.name),
    ),
    filter,
    search,
  );
  const actions: RowActions = {
    current,
    checkout: (row) =>
      run(`Check out ${row.name}`, () =>
        row.local
          ? api.checkoutBranch(path, row.local.name, false)
          : api.checkoutBranch(path, detailsOf(row).name, true),
      ),
    merge: (row, mode) =>
      run(`Merge ${row.name}`, () => api.mergeBranch(path, detailsOf(row).name, mode)),
    rebase: (row) => run(`Rebase onto ${row.name}`, () => api.rebaseOnto(path, detailsOf(row).name)),
    rename: (branch) => setPrompt({ kind: "rename", branch }),
    setUpstream: (branch) => setPrompt({ kind: "upstream", branch }),
    remove: (branch) =>
      void confirm({ kind: "deleteBranch", name: branch.name }, () =>
        void run(`Delete branch ${branch.name}`, () => api.deleteBranch(path, branch.name)),
      ).catch((failure) => setError(describeError(failure))),
    removeRemote: (remote, name) =>
      void confirm({ kind: "deleteRemoteBranch", remote, name }, () =>
        void run(`Delete branch ${name} on ${remote}`, () => api.deleteRemoteBranch(path, remote, name)),
      ).catch((failure) => setError(describeError(failure))),
  };

  return (
    <div className="branches">
      <NewBranchForm
        onCreate={(name, switchTo) =>
          run(`Create branch ${name}`, () => api.createBranchHere(path, name, switchTo))
        }
      />
      <div className="branch-toolbar">
        <TextInput
          type="search"
          aria-label="Search branches"
          placeholder="Search branches"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <SegmentedControl label="Show" options={filterOptions} value={filter} onChange={setFilter} />
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <BranchList rows={rows} actions={actions} />
      {prompt && (
        <BranchPrompt
          prompt={prompt}
          onCancel={() => setPrompt(null)}
          onSubmit={(value) => {
            const { branch } = prompt;
            setPrompt(null);
            void (prompt.kind === "rename"
              ? run(`Rename branch ${branch.name}`, () => api.renameBranch(path, branch.name, value))
              : run(`Set upstream of ${branch.name}`, () =>
                  api.setBranchUpstream(path, branch.name, value === "" ? null : value),
                ));
          }}
        />
      )}
      {dialog}
    </div>
  );
}

interface RowActions {
  current: BranchInfo | undefined;
  checkout: (row: BranchRow) => void;
  merge: (row: BranchRow, mode: MergeMode) => void;
  rebase: (row: BranchRow) => void;
  rename: (branch: BranchInfo) => void;
  setUpstream: (branch: BranchInfo) => void;
  remove: (branch: BranchInfo) => void;
  removeRemote: (remote: string, name: string) => void;
}

function BranchList({ rows, actions }: { rows: BranchRow[]; actions: RowActions }) {
  if (rows.length === 0) return <p className="settings-hint">No branches match.</p>;

  return (
    <ul aria-label="Branches" className="branch-list">
      {rows.map((row) => (
        <BranchItem key={row.name} row={row} actions={actions} />
      ))}
    </ul>
  );
}

function BranchItem({ row, actions }: { row: BranchRow; actions: RowActions }) {
  const branch = detailsOf(row);
  const local = row.local;
  const canJoin = !branch.current && actions.current !== undefined;
  const menu = useActionMenu();

  const items: MenuItem[] = [];
  if (canJoin) {
    items.push(
      { key: "merge", label: "Merge", run: () => actions.merge(row, "default") },
      { key: "merge-no-ff", label: "Merge (no-ff)", run: () => actions.merge(row, "noFastForward") },
      { key: "squash", label: "Squash", run: () => actions.merge(row, "squash") },
      { key: "rebase", label: "Rebase onto", run: () => actions.rebase(row) },
    );
  }
  if (local) {
    items.push(
      { key: "rename", label: "Rename", separated: items.length > 0, run: () => actions.rename(local) },
      { key: "upstream", label: "Set upstream", run: () => actions.setUpstream(local) },
    );
    if (!local.current) {
      items.push({
        key: "delete",
        label: "Delete",
        destructive: true,
        separated: true,
        run: () => actions.remove(local),
      });
    }
  }
  for (const { remote } of row.remotes) {
    items.push({
      key: `delete-${remote}`,
      label: `Delete on ${remote}`,
      destructive: true,
      separated: items.length > 0 && !items[items.length - 1]?.destructive,
      run: () => actions.removeRemote(remote, row.name),
    });
  }

  return (
    <li
      className="branch-row"
      aria-current={branch.current || undefined}
      onContextMenu={items.length > 0 ? menu.openFromContextMenu : undefined}
    >
      <TruncatedText className="branch-name" text={row.name} />
      {local && <span className="branch-presence">local</span>}
      {row.remotes.map(({ remote }) => (
        <span key={remote} className="branch-presence">
          {remote}
        </span>
      ))}
      {branch.current && <span className="branch-badge">current</span>}
      {branch.merged && !branch.current && <span className="branch-badge">merged</span>}
      {branch.upstream && <TruncatedText className="branch-upstream" text={branch.upstream} />}
      {(branch.ahead > 0 || branch.behind > 0) && (
        <span className="branch-counts" aria-label={`${branch.ahead} ahead, ${branch.behind} behind`}>
          ↑{branch.ahead} ↓{branch.behind}
        </span>
      )}
      <span className="branch-actions">
        {!branch.current && (
          <Button size="sm" aria-label={`Check out ${row.name}`} onClick={() => actions.checkout(row)}>
            Check out
          </Button>
        )}
        {items.length > 0 && (
          <OptionsButton
            label={`Options for ${row.name}`}
            expanded={menu.open !== null}
            onClick={menu.openFromButton}
          />
        )}
      </span>
      {menu.open && (
        <ActionMenu
          label={`Actions for ${row.name}`}
          items={items}
          x={menu.open.x}
          y={menu.open.y}
          onClose={menu.close}
        />
      )}
    </li>
  );
}

function NewBranchForm({ onCreate }: { onCreate: (name: string, switchTo: boolean) => Promise<void> }) {
  const [name, setName] = useState("");
  const nameId = useId();
  const empty = name.trim() === "";

  async function create(switchTo: boolean) {
    if (empty) return;
    await onCreate(name.trim(), switchTo);
    setName("");
  }

  return (
    <form
      className="new-branch"
      aria-label="New branch"
      onSubmit={(event) => {
        event.preventDefault();
        void create(true);
      }}
    >
      <label htmlFor={nameId}>New branch</label>
      <TextInput id={nameId} value={name} onChange={(event) => setName(event.target.value)} />
      <Button disabled={empty} onClick={() => void create(false)}>
        Create
      </Button>
      <Button variant="primary" type="submit" disabled={empty}>
        Create & Switch
      </Button>
    </form>
  );
}

function BranchPrompt({
  prompt,
  onSubmit,
  onCancel,
}: {
  prompt: Prompt;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}) {
  const titleId = useId();
  const inputId = useId();
  const renaming = prompt.kind === "rename";
  const [value, setValue] = useState(renaming ? prompt.branch.name : (prompt.branch.upstream ?? ""));

  return (
    <div className="dialog-backdrop">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="dialog"
        onKeyDown={(event) => event.key === "Escape" && onCancel()}
      >
        <h2 id={titleId}>
          {renaming ? `Rename ${prompt.branch.name}` : `Upstream of ${prompt.branch.name}`}
        </h2>
        <form
          className="add-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!renaming || value.trim() !== "") onSubmit(value.trim());
          }}
        >
          <label htmlFor={inputId}>{renaming ? "New name" : "Upstream branch, such as origin/main"}</label>
          <TextInput id={inputId} value={value} onChange={(event) => setValue(event.target.value)} autoFocus />
          {!renaming && <p className="settings-hint">Leave empty to stop tracking.</p>}
          <div className="dialog-actions">
            <Button type="button" onClick={onCancel}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" disabled={renaming && value.trim() === ""}>
              {renaming ? "Rename" : "Set upstream"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
