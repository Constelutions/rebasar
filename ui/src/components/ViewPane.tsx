import type { CoreApi } from "../core/api";
import { HistoryView } from "../history/HistoryView";
import type { ViewName } from "../views";
import type { OpenTab } from "../useOpenTabs";
import { ChangesView } from "./ChangesView";
import { PullRequestsView } from "./PullRequestsView";
import { SettingsView } from "./SettingsView";

interface ViewPaneProps {
  view: ViewName;
  api: CoreApi;
  tab: OpenTab | undefined;
}

export function ViewPane({ view, api, tab }: ViewPaneProps) {
  return (
    <main className="view-pane">
      <h1>{view}</h1>
      <ViewContent view={view} api={api} tab={tab} />
    </main>
  );
}

function ViewContent({ view, api, tab }: ViewPaneProps) {
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
    return <HistoryView key={tab.tab.worktreePath} api={api} tab={tab.tab} />;
  }
  if (view === "Pull requests" && tab) return <PullRequestsView api={api} tab={tab.tab} />;
  return <p className="placeholder">Nothing here yet.</p>;
}
