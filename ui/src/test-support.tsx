import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { App } from "./App";
import type { CoreApi, HistoryRow, Tab } from "./core/api";
import { createStubCoreApi } from "./core/stub";
import type { Highlighter } from "./highlight/highlighter";
import type { AppWindow } from "./shell/appWindow";

export const sampleTab: Tab = {
  repositoryName: "sample",
  worktreePath: "C:\\work\\sample",
  head: { kind: "branch", name: "main" },
};

/** Seconds since the epoch for a moment on the machine's local clock, so day headings do not depend on its time zone. */
export function localTime(year: number, month: number, day: number, hour: number): number {
  return new Date(year, month - 1, day, hour).getTime() / 1000;
}

export function commitRow(overrides: Partial<HistoryRow> = {}): HistoryRow {
  const id = overrides.id ?? "0123456789abcdef0123456789abcdef01234567";
  return {
    id,
    shortId: id.slice(0, 7),
    subject: "A commit",
    authorName: "Ada Lovelace",
    authorEmail: "ada@example.com",
    timestamp: localTime(2026, 1, 5, 12),
    lane: 0,
    laneCount: 1,
    edges: [
      { kind: "incoming", lane: 0 },
      { kind: "outgoing", lane: 0 },
    ],
    refs: [],
    ...overrides,
  };
}

export function numberedCommits(count: number): HistoryRow[] {
  return Array.from({ length: count }, (_, index) =>
    commitRow({
      id: index.toString(16).padStart(40, "0"),
      subject: `Commit ${index}`,
      timestamp: localTime(2026, 1, 5, 12) - index,
    }),
  );
}

export function createFakeWindow() {
  return {
    minimize: vi.fn(async () => {}),
    toggleMaximize: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
  } satisfies AppWindow;
}

interface RenderAppOptions {
  api?: CoreApi;
  pickFolder?: () => Promise<string | null>;
  appWindow?: AppWindow;
  highlighter?: Highlighter;
}

export function renderApp({
  api = createStubCoreApi(),
  pickFolder = async () => null,
  appWindow = createFakeWindow(),
  highlighter,
}: RenderAppOptions = {}) {
  return render(
    <App api={api} pickFolder={pickFolder} appWindow={appWindow} highlighter={highlighter} />,
  );
}

/** Opens a folder whose Worktree has the given laid-out commits and switches to the History view. */
export async function showHistory(rows: HistoryRow[], wrap: (api: CoreApi) => CoreApi = (api) => api) {
  const user = userEvent.setup();
  const api = wrap(
    createStubCoreApi({ [sampleTab.worktreePath]: sampleTab }, {}, { [sampleTab.worktreePath]: rows }),
  );
  renderApp({ api, pickFolder: async () => sampleTab.worktreePath });
  await user.click(screen.getByRole("button", { name: /open folder/i }));
  await screen.findByRole("tab");
  await user.click(screen.getByRole("button", { name: "History" }));
  return user;
}

export async function scrollHistory(position: { top?: number; left?: number }) {
  const scroller = screen.getByRole("list", { name: "Commit history" }).parentElement!;
  for (const [property, value] of Object.entries(position)) {
    const name = property === "top" ? "scrollTop" : "scrollLeft";
    Object.defineProperty(scroller, name, { value, configurable: true });
  }
  await act(async () => {
    fireEvent.scroll(scroller);
  });
}
