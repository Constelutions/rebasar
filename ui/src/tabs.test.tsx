import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { FileChange, Tab, WorktreeStatus } from "./core/api";
import { createStubCoreApi } from "./core/stub";
import { renderApp } from "./test-support";

const app: Tab = {
  repositoryName: "app",
  worktreePath: "C:\\work\\app",
  head: { kind: "branch", name: "main" },
};
const hotfix: Tab = {
  repositoryName: "app",
  worktreePath: "C:\\work\\app-hotfix",
  head: { kind: "branch", name: "hotfix" },
};
const tools: Tab = {
  repositoryName: "tools",
  worktreePath: "C:\\work\\tools",
  head: { kind: "branch", name: "main" },
};

function change(path: string, kind: FileChange["kind"] = "modified"): FileChange {
  return { path, originalPath: null, kind, added: 1, removed: 0 };
}

const clean: WorktreeStatus = { conflicts: [], staged: [], unstaged: [] };
function inFiles() {
  return within(screen.getByRole("list", { name: "Changed files" }));
}

const dirty: WorktreeStatus = { ...clean, unstaged: [change("notes.md")] };
const conflicted: WorktreeStatus = { ...clean, conflicts: [change("merge.ts", "conflicted")] };

async function openTabs(
  tabs: Tab[],
  statuses: Record<string, WorktreeStatus> = {},
) {
  const user = userEvent.setup();
  const api = createStubCoreApi(
    Object.fromEntries(tabs.map((tab) => [tab.worktreePath, tab])),
    statuses,
  );
  const folders = tabs.map((tab) => tab.worktreePath);
  renderApp({ api, pickFolder: async () => folders.shift() ?? null });
  for (let opened = 1; opened <= tabs.length; opened++) {
    await user.click(screen.getByRole("button", { name: /open folder/i }));
    await vi.waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(opened));
  }
  return { user, api };
}

function tabFor(tab: Tab) {
  const found = screen
    .getAllByRole("tab")
    .find((element) => element.getAttribute("title") === tab.worktreePath);
  if (!found) throw new Error(`no Tab for ${tab.worktreePath}`);
  return found;
}

function dotOf(tab: Tab) {
  return within(tabFor(tab)).getByRole("img");
}

it("keeps every opened Worktree as its own Tab and activates the newest", async () => {
  await openTabs([app, hotfix, tools]);

  expect(screen.getAllByRole("tab")).toHaveLength(3);
  expect(tabFor(tools)).toHaveAttribute("aria-selected", "true");
  expect(tabFor(app)).toHaveAttribute("aria-selected", "false");
});

it("shows the Repository name and the branch on each Tab", async () => {
  await openTabs([app, hotfix]);

  expect(tabFor(app)).toHaveTextContent("app");
  expect(tabFor(app)).toHaveTextContent("main");
  expect(tabFor(hotfix)).toHaveTextContent("hotfix");
});

it("shows a live status dot on every Tab, not just the active one", async () => {
  await openTabs([app, hotfix, tools], {
    [app.worktreePath]: clean,
    [hotfix.worktreePath]: dirty,
    [tools.worktreePath]: conflicted,
  });

  await vi.waitFor(() => {
    expect(dotOf(app)).toHaveAccessibleName("No changes");
    expect(dotOf(hotfix)).toHaveAccessibleName("Has changes");
    expect(dotOf(tools)).toHaveAccessibleName("Has conflicts");
  });
});

it("updates the dot of a background Tab when its Worktree changes outside the app", async () => {
  const { api } = await openTabs([app, tools], {
    [app.worktreePath]: clean,
    [tools.worktreePath]: clean,
  });
  await vi.waitFor(() => expect(dotOf(app)).toHaveAccessibleName("No changes"));

  api.changeWorktree(app.worktreePath, dirty);

  await vi.waitFor(() => expect(dotOf(app)).toHaveAccessibleName("Has changes"));
});

it("updates the branch shown on a Tab when it is switched outside the app", async () => {
  const { api } = await openTabs([app]);

  api.checkOut(app.worktreePath, { kind: "branch", name: "feature" });

  await vi.waitFor(() => expect(tabFor(app)).toHaveTextContent("feature"));
  expect(tabFor(app)).not.toHaveTextContent("main");
});

it("switches to a Tab by clicking it and tells the core", async () => {
  const { user, api } = await openTabs([app, tools]);

  await user.click(tabFor(app));

  expect(tabFor(app)).toHaveAttribute("aria-selected", "true");
  expect(tabFor(tools)).toHaveAttribute("aria-selected", "false");
  expect(api.activeWorktree).toBe(app.worktreePath);
});

it("shows the Changes of the Tab that was switched to", async () => {
  const { user } = await openTabs([app, tools], {
    [app.worktreePath]: dirty,
    [tools.worktreePath]: { ...clean, staged: [change("tools.rs", "added")] },
  });
  await user.click(screen.getByRole("button", { name: "Changes" }));
  await inFiles().findByText("tools.rs");

  await user.click(tabFor(app));

  expect(await inFiles().findByText("notes.md")).toBeInTheDocument();
  expect(screen.queryByText("tools.rs", { selector: ".changes-files *" })).not.toBeInTheDocument();
});

it("shows the last-known view at once when switching and refreshes it in the background", async () => {
  const { user, api } = await openTabs([app, tools], {
    [app.worktreePath]: dirty,
    [tools.worktreePath]: clean,
  });
  await user.click(screen.getByRole("button", { name: "Changes" }));
  await vi.waitFor(() => expect(dotOf(app)).toHaveAccessibleName("Has changes"));
  const release = api.holdStatusReads();

  await user.click(tabFor(app));

  expect(inFiles().getByText("notes.md")).toBeInTheDocument();

  api.changeWorktree(app.worktreePath, { ...clean, unstaged: [change("newer.md")] });
  expect(inFiles().getByText("notes.md")).toBeInTheDocument();
  release();

  expect(await screen.findByText("newer.md")).toBeInTheDocument();
  expect(screen.queryByText("notes.md", { selector: ".changes-files *" })).not.toBeInTheDocument();
});

const longBranch: Tab = {
  repositoryName: "app",
  worktreePath: "C:\\work\\app-consolidate-pull-request-views",
  head: { kind: "branch", name: "feat/304-consolidate-pull-request-views" },
};

it("shows the Worktree name above the branch on the switcher button", async () => {
  await openTabs([app, hotfix]);

  const button = screen.getByRole("button", { name: "Switch repository" });
  const [worktree, branch] = Array.from(button.querySelectorAll(".switcher-worktree, .switcher-head"));
  expect(worktree).toHaveClass("switcher-worktree");
  expect(worktree).toHaveTextContent("app-hotfix");
  expect(branch).toHaveClass("switcher-head");
  expect(branch).toHaveTextContent("hotfix");
});

it("keeps the full Worktree and branch names reachable when the switcher button truncates them", async () => {
  await openTabs([longBranch]);

  const button = screen.getByRole("button", { name: "Switch repository" });
  expect(button.querySelector(".switcher-head")).toHaveAttribute(
    "title",
    "feat/304-consolidate-pull-request-views",
  );
  expect(button.querySelector(".switcher-worktree")).toHaveAttribute(
    "title",
    "app-consolidate-pull-request-views",
  );
});

it("follows the active Tab on the switcher button", async () => {
  const { user } = await openTabs([app, tools]);
  const button = screen.getByRole("button", { name: "Switch repository" });
  expect(button).toHaveTextContent("tools");

  await user.click(tabFor(app));

  expect(button).toHaveTextContent("main");
  expect(button).not.toHaveTextContent("tools");
});

it("lists the open Repositories and Worktrees in the repository switcher", async () => {
  const { user } = await openTabs([app, hotfix, tools]);

  await user.click(screen.getByRole("button", { name: "Switch repository" }));

  const menu = screen.getByRole("menu", { name: "Repositories" });
  const items = within(menu).getAllByRole("menuitem");
  expect(items.map((item) => item.textContent)).toEqual([
    expect.stringContaining("app"),
    expect.stringContaining("app"),
    expect.stringContaining("tools"),
  ]);
  expect(items[0]).toHaveTextContent("main");
  expect(items[1]).toHaveTextContent("hotfix");
});

it("jumps to the chosen Worktree from the repository switcher", async () => {
  const { user, api } = await openTabs([app, hotfix, tools]);
  await user.click(screen.getByRole("button", { name: "Switch repository" }));

  await user.click(screen.getByRole("menuitem", { name: /hotfix/ }));

  expect(tabFor(hotfix)).toHaveAttribute("aria-selected", "true");
  expect(api.activeWorktree).toBe(hotfix.worktreePath);
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
});

it("narrows the repository switcher as the user types", async () => {
  const { user } = await openTabs([app, hotfix, tools]);
  await user.click(screen.getByRole("button", { name: "Switch repository" }));

  await user.type(screen.getByRole("searchbox", { name: "Filter Repositories" }), "tools");

  const items = within(screen.getByRole("menu")).getAllByRole("menuitem");
  expect(items).toHaveLength(1);
  expect(items[0]).toHaveTextContent("tools");
});

it("closes the repository switcher with Escape", async () => {
  const { user } = await openTabs([app]);
  await user.click(screen.getByRole("button", { name: "Switch repository" }));

  await user.keyboard("{Escape}");

  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
});

it("tells the user when Tabs fall back to polling and stops once they are watched again", async () => {
  const { api } = await openTabs([app, tools]);

  api.setPolling([app.worktreePath]);

  expect(await screen.findByText(/1 Tab .*checked periodically/i)).toBeInTheDocument();

  api.setPolling([]);

  await vi.waitFor(() =>
    expect(screen.queryByText(/checked periodically/i)).not.toBeInTheDocument(),
  );
});
