import { type FormEvent, useCallback, useEffect, useId, useState } from "react";

import type { BranchInfo, CoreApi, MergeMode, MutationOutcome, Tab } from "../core/api";
import { describeError } from "../core/describeError";
import { useConfirmation } from "../useConfirmation";
import { Button } from "./Button";
import { RemotesSection, TagsSection } from "./TagsAndRemotes";

interface BranchesViewProps {
  api: CoreApi;
  tab: Tab;
}

type Prompt =
  | { kind: "rename"; branch: BranchInfo }
  | { kind: "upstream"; branch: BranchInfo };

export function BranchesView({ api, tab }: BranchesViewProps) {
  const path = tab.worktreePath;
  const [branches, setBranches] = useState<BranchInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const { confirm, dialog } = useConfirmation(api, path);

  const reload = useCallback(async () => {
    try {
      setBranches(await api.listBranchDetails(path));
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
  const local = branches.filter((branch) => branch.kind === "local");
  const remote = branches.filter((branch) => branch.kind === "remote");
  const actions: RowActions = {
    current,
    checkout: (branch) =>
      run(`Check out ${branch.name}`, () =>
        api.checkoutBranch(path, branch.name, branch.kind === "remote"),
      ),
    merge: (branch, mode) =>
      run(`Merge ${branch.name}`, () => api.mergeBranch(path, branch.name, mode)),
    rebase: (branch) => run(`Rebase onto ${branch.name}`, () => api.rebaseOnto(path, branch.name)),
    rename: (branch) => setPrompt({ kind: "rename", branch }),
    setUpstream: (branch) => setPrompt({ kind: "upstream", branch }),
    remove: (branch) =>
      void confirm({ kind: "deleteBranch", name: branch.name }, () =>
        void run(`Delete branch ${branch.name}`, () => api.deleteBranch(path, branch.name)),
      ).catch((failure) => setError(describeError(failure))),
  };

  return (
    <div className="branches">
      <NewBranchForm
        onCreate={(name, switchTo) =>
          run(`Create branch ${name}`, () => api.createBranchHere(path, name, switchTo))
        }
      />
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <BranchList label="Local branches" branches={local} actions={actions} />
      {remote.length > 0 && (
        <BranchList label="Remote branches" branches={remote} actions={actions} />
      )}
      <TagsSection api={api} worktreePath={path} onError={setError} />
      <RemotesSection api={api} worktreePath={path} onError={setError} />
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
  checkout: (branch: BranchInfo) => void;
  merge: (branch: BranchInfo, mode: MergeMode) => void;
  rebase: (branch: BranchInfo) => void;
  rename: (branch: BranchInfo) => void;
  setUpstream: (branch: BranchInfo) => void;
  remove: (branch: BranchInfo) => void;
}

function BranchList({
  label,
  branches,
  actions,
}: {
  label: string;
  branches: BranchInfo[];
  actions: RowActions;
}) {
  return (
    <section aria-label={label} className="branch-section">
      <h2>{label}</h2>
      <ul className="branch-list">
        {branches.map((branch) => (
          <BranchRow key={`${branch.kind}:${branch.name}`} branch={branch} actions={actions} />
        ))}
      </ul>
    </section>
  );
}

function BranchRow({ branch, actions }: { branch: BranchInfo; actions: RowActions }) {
  const isLocal = branch.kind === "local";
  const canJoin = !branch.current && actions.current !== undefined;

  return (
    <li className="branch-row" aria-current={branch.current || undefined}>
      <span className="branch-name">{branch.name}</span>
      {branch.current && <span className="branch-badge">current</span>}
      {branch.merged && !branch.current && <span className="branch-badge">merged</span>}
      {branch.upstream && <span className="branch-upstream">{branch.upstream}</span>}
      {(branch.ahead > 0 || branch.behind > 0) && (
        <span className="branch-counts" aria-label={`${branch.ahead} ahead, ${branch.behind} behind`}>
          ↑{branch.ahead} ↓{branch.behind}
        </span>
      )}
      <span className="branch-actions">
        {!branch.current && (
          <Button size="sm" type="button" aria-label={`Check out ${branch.name}`} onClick={() => actions.checkout(branch)}>
            Check out
          </Button>
        )}
        {canJoin && (
          <>
            <Button size="sm" type="button" aria-label={`Merge ${branch.name}`} onClick={() => actions.merge(branch, "default")}>
              Merge
            </Button>
            <Button
              size="sm"
              type="button"
              aria-label={`Merge ${branch.name} with a merge commit`}
              onClick={() => actions.merge(branch, "noFastForward")}
            >
              Merge (no-ff)
            </Button>
            <Button
              size="sm"
              type="button"
              aria-label={`Squash merge ${branch.name}`}
              onClick={() => actions.merge(branch, "squash")}
            >
              Squash
            </Button>
            <Button size="sm" type="button" aria-label={`Rebase onto ${branch.name}`} onClick={() => actions.rebase(branch)}>
              Rebase onto
            </Button>
          </>
        )}
        {isLocal && (
          <>
            <Button size="sm" type="button" aria-label={`Rename ${branch.name}`} onClick={() => actions.rename(branch)}>
              Rename
            </Button>
            <Button
              size="sm"
              type="button"
              aria-label={`Set upstream of ${branch.name}`}
              onClick={() => actions.setUpstream(branch)}
            >
              Upstream
            </Button>
            {!branch.current && (
              <Button
                size="sm"
                type="button"
                variant="danger"
                aria-label={`Delete ${branch.name}`}
                onClick={() => actions.remove(branch)}
              >
                Delete
              </Button>
            )}
          </>
        )}
      </span>
    </li>
  );
}

function NewBranchForm({ onCreate }: { onCreate: (name: string, switchTo: boolean) => Promise<void> }) {
  const [name, setName] = useState("");
  const [switchTo, setSwitchTo] = useState(true);
  const nameId = useId();

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (name.trim() === "") return;
    await onCreate(name.trim(), switchTo);
    setName("");
  }

  return (
    <form className="new-branch" aria-label="New branch" onSubmit={submit}>
      <label htmlFor={nameId}>New branch</label>
      <input id={nameId} value={name} onChange={(event) => setName(event.target.value)} />
      <label className="option">
        <input type="checkbox" checked={switchTo} onChange={(event) => setSwitchTo(event.target.checked)} />
        Switch to it
      </label>
      <Button variant="primary" type="submit" disabled={name.trim() === ""}>
        Create
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
          <input id={inputId} value={value} onChange={(event) => setValue(event.target.value)} autoFocus />
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
