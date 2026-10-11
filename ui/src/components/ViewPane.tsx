import type { CoreApi } from "../core/api";
import { HistoryView } from "../history/HistoryView";
import type { ViewName } from "../views";
import type { OpenTab } from "../useOpenTabs";
import { ChangesView } from "./ChangesView";

interface ViewPaneProps {
  view: ViewName;
  api: CoreApi;
  tab: OpenTab | undefined;
}

export function ViewPane({ view, api, tab }: ViewPaneProps) {
  return (
    <main className="view-pane">
      <h1>{view}</h1>
      {view === "Changes" && tab ? (
        <ChangesView
          api={api}
          worktreePath={tab.tab.worktreePath}
          status={tab.status}
          error={tab.error}
        />
      ) : view === "History" ? (
        tab ? (
          <HistoryView key={tab.tab.worktreePath} api={api} tab={tab.tab} />
        ) : (
          <p className="placeholder">Open a folder to see its history.</p>
        )
      ) : (
        <p className="placeholder">Nothing here yet.</p>
      )}
    </main>
  );
}
