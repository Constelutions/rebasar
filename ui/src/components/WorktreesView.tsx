import { type FormEvent, useCallback, useEffect, useId, useState } from "react";

import type {
  BranchInfo,
  CoreApi,
  MutationOutcome,
  Tab,
  WorktreeDetail,
  WorktreeStart,
} from "../core/api";
import { describeError } from "../core/describeError";
import { useConfirmation } from "../useConfirmation";
import { Button } from "./Button";
import { Select, TextInput } from "./FormControls";
import { describeHead } from "./TabStrip";
import { TruncatedText } from "./TruncatedText";

interface WorktreesViewProps {
  api: CoreApi;
  tab: Tab;
  pickFolder: () => Promise<string | null>;
}

export function WorktreesView({ api, tab, pickFolder }: WorktreesViewProps) {
  const path = tab.worktreePath;
  const [worktrees, setWorktrees] = useState<WorktreeDetail[] | null>(null);
  const [branches, setBranches] = useState<BranchInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const { confirm, dialog } = useConfirmation(api, path);

  const reload = useCallback(async () => {
    try {
      setWorktrees(await api.listWorktreeDetails(path));
      setBranches(await api.listBranchDetails(path));
    } catch (failure) {
      setError(describeError(failure));
    }
  }, [api, path]);

  useEffect(() => {
    void reload();
    const subscription = api.onEvent((event) => {
      if (event.type === "worktreeChanged") void reload();
    });
    return () => {
      void subscription.then((unsubscribe) => unsubscribe());
    };
  }, [api, reload]);

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

  if (worktrees === null) {
    return error ? (
      <p role="alert" className="error">
        {error}
      </p>
    ) : null;
  }

  return (
    <div className="worktrees">
      <NewWorktreeForm
        branches={branches.filter((branch) => branch.kind === "local")}
        pickFolder={pickFolder}
        onCreate={(target, from, newBranch) =>
          run("Adding the worktree", () => api.createWorktree(path, target, from, newBranch))
        }
      />
      <div className="worktrees-toolbar">
        <Button type="button" onClick={() => void run("Pruning", () => api.pruneWorktrees(path))}>
          Prune
        </Button>
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <ul className="worktree-list" aria-label="Worktrees">
        {worktrees.map((worktree) => (
          <li key={worktree.path} className="worktree-row">
            <TruncatedText className="worktree-head" text={describeHead(worktree.head)} />
            <TruncatedText path className="worktree-path" text={worktree.path} />
            <span className="branch-badge">{worktree.dirty ? "dirty" : "clean"}</span>
            {worktree.main && <span className="branch-badge">main</span>}
            <span className="branch-actions">
              <Button
                size="sm"
                type="button"
                aria-label={`Open ${worktree.path} as a Tab`}
                onClick={() =>
                  void api.openFolder(worktree.path).catch((failure) => setError(describeError(failure)))
                }
              >
                Open
              </Button>
              {!worktree.main && (
                <Button
                  size="sm"
                  type="button"
                  variant="danger"
                  aria-label={`Remove ${worktree.path}`}
                  onClick={() =>
                    void confirm({ kind: "removeWorktree", path: worktree.path }, () =>
                      void run("Removing the worktree", () =>
                        api.removeWorktree(path, worktree.path, true),
                      ),
                    ).catch((failure) => setError(describeError(failure)))
                  }
                >
                  Remove
                </Button>
              )}
            </span>
          </li>
        ))}
      </ul>
      {dialog}
    </div>
  );
}

function NewWorktreeForm({
  branches,
  pickFolder,
  onCreate,
}: {
  branches: BranchInfo[];
  pickFolder: () => Promise<string | null>;
  onCreate: (target: string, from: WorktreeStart, newBranch: string | null) => Promise<void>;
}) {
  const folderId = useId();
  const sourceId = useId();
  const commitId = useId();
  const branchId = useId();
  const [folder, setFolder] = useState("");
  const [source, setSource] = useState("commit");
  const [commit, setCommit] = useState("");
  const [newBranch, setNewBranch] = useState("");

  const sourceValue = source === "commit" ? commit.trim() : source;
  const from: WorktreeStart | null =
    sourceValue === "" ? null : source === "commit" ? { kind: "commit", id: sourceValue } : { kind: "branch", name: sourceValue };

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!from || folder.trim() === "") return;
    await onCreate(folder.trim(), from, newBranch.trim() === "" ? null : newBranch.trim());
    setFolder("");
  }

  return (
    <form className="new-worktree" aria-label="New worktree" onSubmit={submit}>
      <label htmlFor={folderId}>Folder</label>
      <TextInput id={folderId} value={folder} onChange={(event) => setFolder(event.target.value)} />
      <Button
        type="button"
        onClick={async () => {
          const picked = await pickFolder();
          if (picked !== null) setFolder(picked.replace(/[\\/]+$/, "") + "/" + (newBranch.trim() || "worktree"));
        }}
      >
        Choose folder…
      </Button>
      <label htmlFor={sourceId}>Start from</label>
      <Select id={sourceId} value={source} onChange={(event) => setSource(event.target.value)}>
        {branches.map((branch) => (
          <option key={branch.name} value={branch.name}>
            Branch {branch.name}
          </option>
        ))}
        <option value="commit">A commit…</option>
      </Select>
      {source === "commit" && (
        <>
          <label htmlFor={commitId}>Commit</label>
          <TextInput id={commitId} value={commit} onChange={(event) => setCommit(event.target.value)} />
        </>
      )}
      <label htmlFor={branchId}>New branch (optional)</label>
      <TextInput id={branchId} value={newBranch} onChange={(event) => setNewBranch(event.target.value)} />
      <Button variant="primary" type="submit" disabled={!from || folder.trim() === ""}>
        Add worktree
      </Button>
    </form>
  );
}
