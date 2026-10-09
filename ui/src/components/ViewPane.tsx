import type { ViewName } from "../views";

export function ViewPane({ view }: { view: ViewName }) {
  return (
    <main className="view-pane">
      <h1>{view}</h1>
      <p className="placeholder">Nothing here yet.</p>
    </main>
  );
}
