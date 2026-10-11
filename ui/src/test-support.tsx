import { render } from "@testing-library/react";

import { App } from "./App";
import type { CoreApi, HistoryRow, Tab } from "./core/api";
import { createStubCoreApi } from "./core/stub";
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
}

export function renderApp({
  api = createStubCoreApi(),
  pickFolder = async () => null,
  appWindow = createFakeWindow(),
}: RenderAppOptions = {}) {
  return render(<App api={api} pickFolder={pickFolder} appWindow={appWindow} />);
}
