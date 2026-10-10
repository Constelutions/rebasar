import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { Session, Tab, WorktreeStatus } from "./core/api";
import { createStubCoreApi } from "./core/stub";
import { renderApp } from "./test-support";

const app: Tab = {
  repositoryName: "app",
  worktreePath: "C:\\work\\app",
  head: { kind: "branch", name: "main" },
};
const tools: Tab = {
  repositoryName: "tools",
  worktreePath: "C:\\work\\tools",
  head: { kind: "branch", name: "release" },
};
const dirty: WorktreeStatus = {
  conflicts: [],
  staged: [],
  unstaged: [{ path: "notes.md", originalPath: null, kind: "modified", added: 1, removed: 0 }],
};

function previousRun(overrides: Partial<Session> = {}): Session {
  return { tabs: [app, tools], active: app.worktreePath, view: null, ...overrides };
}

function tabFor(tab: Tab) {
  const found = screen
    .getAllByRole("tab")
    .find((element) => element.getAttribute("title") === tab.worktreePath);
  if (!found) throw new Error(`no Tab for ${tab.worktreePath}`);
  return found;
}

function launch(session: Session, statuses: Record<string, WorktreeStatus> = {}) {
  const api = createStubCoreApi({}, statuses, {}, {}, {}, undefined, { session });
  renderApp({ api });
  return api;
}

it("restores the open Tabs in their order and activates the one that was active", async () => {
  const api = launch(previousRun());

  await vi.waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(2));
  expect(screen.getAllByRole("tab").map((tab) => tab.getAttribute("title"))).toEqual([
    app.worktreePath,
    tools.worktreePath,
  ]);
  expect(tabFor(app)).toHaveAttribute("aria-selected", "true");
  expect(tabFor(tools)).toHaveAttribute("aria-selected", "false");
  await vi.waitFor(() => expect(api.activeWorktree).toBe(app.worktreePath));
});

it("shows the restored Tabs with the branch last seen before any status has loaded", async () => {
  const api = createStubCoreApi({}, {}, {}, {}, {}, undefined, { session: previousRun() });
  const release = api.holdStatusReads();
  renderApp({ api });

  expect(await screen.findAllByRole("tab")).toHaveLength(2);
  expect(tabFor(tools)).toHaveTextContent("release");
  release();
});

it("loads the background Tabs after the active one without taking its place", async () => {
  const api = launch(previousRun(), { [tools.worktreePath]: dirty });

  await vi.waitFor(() =>
    expect(within(tabFor(tools)).getByRole("img")).toHaveAccessibleName("Has changes"),
  );
  expect(api.backgroundWatched).toEqual([tools.worktreePath]);
  expect(api.activeWorktree).toBe(app.worktreePath);
  expect(tabFor(app)).toHaveAttribute("aria-selected", "true");
});

it("restores the view the user was on", async () => {
  launch(previousRun({ view: "Changes" }));

  expect(await screen.findByRole("heading", { level: 1, name: "Changes" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Changes" })).toHaveAttribute("aria-current", "page");
});

it("starts on Home when the remembered view is not one the app knows", async () => {
  launch(previousRun({ view: "Retired view" }));

  await vi.waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(2));
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Home");
});

it("remembers the view the user switches to", async () => {
  const user = userEvent.setup();
  const api = launch(previousRun());

  await user.click(screen.getByRole("button", { name: "History" }));

  expect(api.savedView).toBe("History");
});

it("starts empty on a first launch", async () => {
  const api = launch({ tabs: [], active: null, view: null });

  await vi.waitFor(() => expect(api.activeWorktree).toBeNull());
  expect(screen.queryByRole("tab")).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Home");
});
