import type { CoreApi } from "../core/api";
import { HistoryView } from "../history/HistoryView";
import type { ViewName } from "../views";
import type { OpenTab } from "../useOpenTabs";
import type { AddKind } from "./AddRepositoryDialog";
import { BranchesView } from "./BranchesView";
import { HomeView } from "./HomeView";
import { ConflictsView } from "./ConflictsView";
import { ChangesView } from "./ChangesView";
import { PullRequestsView } from "./PullRequestsView";
import { RepositoriesView } from "./RepositoriesView";
import { WorktreesView } from "./WorktreesView";
import { StashesView } from "./StashesView";
import { SettingsView } from "./SettingsView";

export interface CommitSearch {
  query: string;
  /** Tells a search repeated with the same query from the one already shown. */
  id: number;
}

interface ViewPaneProps {
  view: ViewName;
  api: CoreApi;
  tab: OpenTab | undefined;
  /** The query History starts with; a new search replaces whatever was typed there. */
  commitSearch: CommitSearch;
  pickFolder: () => Promise<string | null>;
  onAddRepository: (kind: AddKind) => void;
  /** Changes whenever Repositories were added, so the Repositories view reads them again. */
  repositoriesVersion: number;
  onNavigate: (view: ViewName) => void;
}

export function ViewPane(props: ViewPaneProps) {
  const { view } = props;
  return (
    <main className="view-pane">
      <h1>{view}</h1>
      <ViewContent {...props} />
    </main>
  );
}

function ViewContent({
  view,
  api,
  tab,
  commitSearch,
  pickFolder,
  onAddRepository,
  repositoriesVersion,
  onNavigate,
}: ViewPaneProps) {
  if (view === "Home") {
    if (!tab) return <p className="placeholder">Open a folder to see its overview.</p>;
    return <HomeView key={tab.tab.worktreePath} api={api} tab={tab.tab} status={tab.status} onNavigate={onNavigate} />;
  }
  if (view === "Repositories") {
    return (
      <RepositoriesView
        api={api}
        pickFolder={pickFolder}
        onAdd={onAddRepository}
        version={repositoriesVersion}
      />
    );
  }
  if (view === "Settings") return <SettingsView api={api} />;
  if (view === "Changes" && tab) {
    return (
      <ChangesView
        api={api}
        worktreePath={tab.tab.worktreePath}
        status={tab.status}
        error={tab.error}
      />
    );
  }
  if (view === "History") {
    if (!tab) return <p className="placeholder">Open a folder to see its history.</p>;
    return (
      <HistoryView
        key={`${tab.tab.worktreePath}:${commitSearch.id}`}
        api={api}
        tab={tab.tab}
        initialQuery={commitSearch.query}
      />
    );
  }
  if (view === "Conflicts") {
    if (!tab) return <p className="placeholder">Open a folder to see its conflicts.</p>;
    return <ConflictsView api={api} worktreePath={tab.tab.worktreePath} status={tab.status} />;
  }
  if (view === "Worktrees") {
    if (!tab) return <p className="placeholder">Open a folder to see its worktrees.</p>;
    return <WorktreesView key={tab.tab.worktreePath} api={api} tab={tab.tab} pickFolder={pickFolder} />;
  }
  if (view === "Stashes") {
    if (!tab) return <p className="placeholder">Open a folder to see its stashes.</p>;
    return <StashesView key={tab.tab.worktreePath} api={api} tab={tab.tab} />;
  }
  if (view === "Branches") {
    if (!tab) return <p className="placeholder">Open a folder to see its branches.</p>;
    return <BranchesView key={tab.tab.worktreePath} api={api} tab={tab.tab} />;
  }
  if (view === "Pull requests" && tab) return <PullRequestsView api={api} tab={tab.tab} />;
  return <p className="placeholder">Nothing here yet.</p>;
}
