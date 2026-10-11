import { useEffect, useId, useState } from "react";

import type { CoreApi, FileChange, Tab, WorktreeStatus } from "../core/api";
import { describeError } from "../core/describeError";
import { FileTree } from "./FileTree";

export function ChangesView({ api, tab }: { api: CoreApi; tab: Tab }) {
  const { status, error } = useWorktreeStatus(api, tab.worktreePath);

  if (error) {
    return (
      <p role="alert" className="error">
        {error}
      </p>
    );
  }
  if (!status) return null;

  const groups = [
    { name: "Conflicts", changes: status.conflicts },
    { name: "Staged", changes: status.staged },
    { name: "Unstaged", changes: status.unstaged },
  ].filter((group) => group.changes.length > 0);
  if (groups.length === 0) return <p className="placeholder">No changes.</p>;

  return (
    <div className="changes">
      {groups.map((group) => (
        <ChangeGroup key={group.name} name={group.name} changes={group.changes} />
      ))}
    </div>
  );
}

function ChangeGroup({ name, changes }: { name: string; changes: FileChange[] }) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="change-group">
      <header className="change-group-header">
        <h2 id={headingId}>{name}</h2>
        <span className="change-group-count">{changes.length}</span>
      </header>
      <FileTree changes={changes} />
    </section>
  );
}

function useWorktreeStatus(api: CoreApi, worktreePath: string) {
  const [status, setStatus] = useState<WorktreeStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    let latestRequest = 0;
    setStatus(null);
    setError(null);

    async function refresh() {
      const request = ++latestRequest;
      try {
        const fresh = await api.worktreeStatus(worktreePath);
        if (!current || request !== latestRequest) return;
        setStatus(fresh);
        setError(null);
      } catch (failure) {
        if (!current || request !== latestRequest) return;
        setError(describeError(failure));
      }
    }

    void refresh();
    const subscription = api.onEvent((event) => {
      if (event.type === "worktreeChanged" && event.worktreePath === worktreePath) {
        void refresh();
      }
    });
    return () => {
      current = false;
      void subscription.then((unsubscribe) => unsubscribe());
    };
  }, [api, worktreePath]);

  return { status, error };
}
