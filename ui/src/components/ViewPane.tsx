import type { CoreApi, Tab } from "../core/api";
import type { ViewName } from "../views";
import { ChangesView } from "./ChangesView";

interface ViewPaneProps {
  view: ViewName;
  api: CoreApi;
  tab: Tab | undefined;
}

export function ViewPane({ view, api, tab }: ViewPaneProps) {
  return (
    <main className="view-pane">
      <h1>{view}</h1>
      {view === "Changes" && tab ? (
        <ChangesView api={api} tab={tab} />
      ) : (
        <p className="placeholder">Nothing here yet.</p>
      )}
    </main>
  );
}
