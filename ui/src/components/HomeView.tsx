import { useCallback, useEffect, useState } from "react";

import type { CoreApi, SyncStatus, Tab, WorktreeStatus } from "../core/api";
import type { ViewName } from "../views";
import { Button } from "./Button";

interface HomeViewProps {
  api: CoreApi;
  tab: Tab;
  status: WorktreeStatus | null;
  onNavigate: (view: ViewName) => void;
}

interface Counts {
  sync: SyncStatus;
  branches: number;
  stashes: number;
  worktrees: number;
  /** `undefined` for a Repository without a GitHub remote; `null` until GitHub can be asked. */
  pullRequests: number | null | undefined;
}

/** A read-only overview: how much there is of each thing, each count a link to its view. */
export function HomeView({ api, tab, status, onNavigate }: HomeViewProps) {
  const path = tab.worktreePath;
  const [counts, setCounts] = useState<Counts | null>(null);

  const load = useCallback(async () => {
    const [sync, branches, stashes, worktrees, pullRequests] = await Promise.all([
      api.syncStatus(path),
      api.listBranchDetails(path),
      api.listStashes(path),
      api.listWorktreeDetails(path),
      countPullRequests(api, path),
    ]);
    setCounts({
      sync,
      branches: branches.filter((branch) => branch.kind === "local").length,
      stashes: stashes.length,
      worktrees: worktrees.length,
      pullRequests,
    });
  }, [api, path]);

  useEffect(() => {
    // A count that cannot be read is left out rather than failing the whole overview.
    const refresh = () => void load().catch(() => {});
    refresh();
    const subscription = api.onEvent((event) => {
      if (event.type === "worktreeChanged" && event.worktreePath === path) refresh();
    });
    return () => {
      void subscription.then((unsubscribe) => unsubscribe());
    };
  }, [api, path, load]);

  const changes = status ? status.conflicts.length + status.staged.length + status.unstaged.length : null;

  return (
    <nav aria-label="Overview" className="home">
      <ul className="home-counts">
        {changes !== null && (
          <Count value={changes} label={changes === 1 ? "change" : "changes"} onClick={() => onNavigate("Changes")} />
        )}
        {counts && (
          <>
            <Count
              value={`↑${counts.sync.ahead} ↓${counts.sync.behind}`}
              label="ahead / behind"
              onClick={() => onNavigate("History")}
            />
            <Count
              value={counts.branches}
              label={counts.branches === 1 ? "branch" : "branches"}
              onClick={() => onNavigate("Branches")}
            />
            <Count
              value={counts.stashes}
              label={counts.stashes === 1 ? "stash" : "stashes"}
              onClick={() => onNavigate("Stashes")}
            />
            <Count
              value={counts.worktrees}
              label={counts.worktrees === 1 ? "worktree" : "worktrees"}
              onClick={() => onNavigate("Worktrees")}
            />
            {counts.pullRequests !== undefined && (
              <Count
                value={counts.pullRequests ?? "–"}
                label={counts.pullRequests === 1 ? "pull request" : "pull requests"}
                onClick={() => onNavigate("Pull requests")}
              />
            )}
          </>
        )}
      </ul>
    </nav>
  );
}

function Count({
  value,
  label,
  onClick,
}: {
  value: number | string;
  label: string;
  onClick: () => void;
}) {
  return (
    <li>
      <Button variant="plain" type="button" className="home-count" onClick={onClick}>
        <span className="home-count-value">{value}</span>
        <span className="home-count-label">{label}</span>
      </Button>
    </li>
  );
}

async function countPullRequests(api: CoreApi, path: string): Promise<number | null | undefined> {
  if ((await api.githubRemote(path)) === null) return undefined;
  if ((await api.githubAuthStatus()).source === null) return null;
  try {
    return (await api.pullRequests(path)).length;
  } catch {
    return null;
  }
}
