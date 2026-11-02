import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { Group, RepositoryEntry, Tab } from "./core/api";
import { createStubCoreApi } from "./core/stub";
import { renderApp } from "./test-support";

const work: Group = { id: "work", name: "Work" };
const personal: Group = { id: "personal", name: "Personal" };

function repository(
  name: string,
  overrides: Partial<RepositoryEntry> = {},
  extraBranches: string[] = [],
): RepositoryEntry {
  const path = `C:\\work\\${name}`;
  return {
    path,
    name,
    groupId: null,
    missing: false,
    worktrees: [
      { path, main: true, head: { kind: "branch", name: "main" } },
      ...extraBranches.map((branch) => ({
        path: `${path}-${branch}`,
        main: false,
        head: { kind: "branch" as const, name: branch },
      })),
    ],
    ...overrides,
  };
}

function tabOf(entry: RepositoryEntry): Tab {
  return {
    repositoryName: entry.name,
    worktreePath: entry.path,
    head: { kind: "branch", name: "main" },
  };
}

async function openRepositoriesView(
  registry: RepositoryEntry[],
  groups: Group[] = [],
  pickFolder: () => Promise<string | null> = async () => null,
) {
  const user = userEvent.setup();
  const api = createStubCoreApi(
    Object.fromEntries(registry.map((entry) => [entry.path, tabOf(entry)])),
    {},
    {},
    {},
    {},
    undefined,
    { registry, groups },
  );
  renderApp({ api, pickFolder });
  await user.click(screen.getByRole("button", { name: "Repositories" }));
  return { user, api };
}

function panel() {
  return within(screen.getByRole("tabpanel"));
}

function tabNames() {
  return within(screen.getByRole("tablist", { name: "Groups" }))
    .getAllByRole("tab")
    .map((tab) => tab.querySelector(".group-tab-name")?.textContent);
}

function windowTabs() {
  return screen.getAllByRole("tab").filter((tab) => !tab.closest("[aria-label=Groups]"));
}

function groupTab(name: string) {
  return screen.getByRole("tab", { name: new RegExp("^" + name) });
}

async function showTab(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(await screen.findByRole("tab", { name: new RegExp("^" + name) }));
}

async function chooseGroupAction(user: ReturnType<typeof userEvent.setup>, group: string, item: string) {
  await showTab(user, group);
  await user.click(screen.getByRole("button", { name: "Options for " + group }));
  await user.click(screen.getByRole("menuitem", { name: item }));
}

it("lists every Repository on the All tab without its Worktrees", async () => {
  await openRepositoriesView([repository("app", {}, ["hotfix"]), repository("tools")]);

  expect(await panel().findAllByRole("listitem", { name: /^(app|tools)$/ })).toHaveLength(2);
  expect(screen.queryByText("hotfix")).not.toBeInTheDocument();
  expect(screen.queryByText(/detached at/)).not.toBeInTheDocument();
});


it("groups Repositories in tabs: All first, one per Group, and Ungrouped last", async () => {
  const { user } = await openRepositoriesView(
    [
      repository("app", { groupId: "work" }),
      repository("notes", { groupId: "personal" }),
      repository("scratch"),
    ],
    [work, personal],
  );

  await screen.findByRole("tab", { name: /^Work/ });
  expect(tabNames()).toEqual(["All", "Work", "Personal", "Ungrouped"]);
  expect(panel().getAllByRole("listitem")).toHaveLength(3);

  await showTab(user, "Work");
  expect(panel().getByRole("listitem", { name: "app" })).toBeInTheDocument();
  expect(panel().queryByRole("listitem", { name: "scratch" })).not.toBeInTheDocument();

  await showTab(user, "Ungrouped");
  expect(panel().getByRole("listitem", { name: "scratch" })).toBeInTheDocument();
});

it("shows no Ungrouped tab while every Repository is in a Group", async () => {
  await openRepositoriesView([repository("app", { groupId: "work" })], [work]);

  await screen.findByRole("tab", { name: /^Work/ });
  expect(tabNames()).toEqual(["All", "Work"]);
});

it("invites the user to open a folder when no Repository is known yet", async () => {
  await openRepositoriesView([]);

  expect(await screen.findByText(/no repositories yet/i)).toBeInTheDocument();
});

it("lists a Repository opened from the title bar", async () => {
  const opened = repository("app");
  const user = userEvent.setup();
  const api = createStubCoreApi({ [opened.path]: tabOf(opened) });
  renderApp({ api, pickFolder: async () => opened.path });
  await user.click(screen.getByRole("button", { name: /open folder/i }));
  await screen.findByRole("tab");

  await user.click(screen.getByRole("button", { name: "Repositories" }));

  expect(await panel().findByRole("listitem", { name: "app" })).toBeInTheDocument();
});

it("creates a Group", async () => {
  const { user } = await openRepositoriesView([repository("app")]);

  await user.click(await screen.findByRole("button", { name: "New group" }));
  await user.type(screen.getByRole("textbox", { name: "Group name" }), "Work{Enter}");

  expect(await screen.findByRole("tab", { name: /^Work/ })).toBeInTheDocument();
  expect(screen.queryByRole("textbox", { name: "Group name" })).not.toBeInTheDocument();
});

it("refuses a Group without a name and keeps the form open", async () => {
  const { user } = await openRepositoriesView([]);

  await user.click(await screen.findByRole("button", { name: "New group" }));
  await user.type(screen.getByRole("textbox", { name: "Group name" }), "   {Enter}");

  expect(await screen.findByRole("alert")).toHaveTextContent("A Group needs a name");
  expect(screen.getByRole("textbox", { name: "Group name" })).toBeInTheDocument();
});

it("cancels creating a Group with Escape", async () => {
  const { user } = await openRepositoriesView([]);

  await user.click(await screen.findByRole("button", { name: "New group" }));
  await user.keyboard("{Escape}");

  expect(screen.queryByRole("textbox", { name: "Group name" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "New group" })).toBeInTheDocument();
});

it("renames a Group from its menu", async () => {
  const { user } = await openRepositoriesView([repository("app", { groupId: "work" })], [work]);

  await chooseGroupAction(user, "Work", "Rename");
  const field = screen.getByRole("textbox", { name: "Group name" });
  expect(field).toHaveValue("Work");
  await user.clear(field);
  await user.type(field, "Day job{Enter}");

  await showTab(user, "Day job");
  expect(tabNames()).toEqual(["All", "Day job"]);
  expect(panel().getByRole("listitem", { name: "app" })).toBeInTheDocument();
});

it("reorders Groups from the menu of a tab", async () => {
  const { user } = await openRepositoriesView([], [work, personal]);

  await chooseGroupAction(user, "Personal", "Move left");

  await vi.waitFor(() => expect(tabNames()).toEqual(["All", "Personal", "Work"]));

  await chooseGroupAction(user, "Personal", "Move right");

  await vi.waitFor(() => expect(tabNames()).toEqual(["All", "Work", "Personal"]));
});

it("cannot move the first Group left or the last Group right, and a right-click opens the menu", async () => {
  const { user } = await openRepositoriesView([], [work, personal]);

  await screen.findByRole("tab", { name: /^Work/ });
  await user.pointer({ keys: "[MouseRight]", target: groupTab("Work") });
  expect(screen.getByRole("menuitem", { name: "Move left" })).toBeDisabled();
  expect(screen.getByRole("menuitem", { name: "Move right" })).toBeEnabled();
  await user.keyboard("{Escape}");

  await user.pointer({ keys: "[MouseRight]", target: groupTab("Personal") });
  expect(screen.getByRole("menuitem", { name: "Move right" })).toBeDisabled();
});

it("moves a Repository into a Group and back to Ungrouped", async () => {
  const { user } = await openRepositoriesView([repository("app")], [work, personal]);
  const mover = await screen.findByRole("combobox", { name: "Move app to group" });

  await user.selectOptions(mover, "Work");

  await vi.waitFor(() => expect(groupTab("Work")).toHaveTextContent("1"));
  expect(screen.queryByRole("tab", { name: /^Ungrouped/ })).not.toBeInTheDocument();

  await user.selectOptions(screen.getByRole("combobox", { name: "Move app to group" }), "Personal");

  await vi.waitFor(() => expect(groupTab("Personal")).toHaveTextContent("1"));
  expect(groupTab("Work")).toHaveTextContent("0");

  await user.selectOptions(screen.getByRole("combobox", { name: "Move app to group" }), "Ungrouped");

  await vi.waitFor(() => expect(groupTab("Ungrouped")).toHaveTextContent("1"));
});

it("offers Locate and Remove only for a Repository whose folder is gone", async () => {
  await openRepositoriesView([repository("app"), repository("gone", { missing: true, worktrees: [] })]);

  expect(await screen.findByRole("button", { name: "Locate gone" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Remove gone" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Locate app" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Remove app" })).not.toBeInTheDocument();
});

it("lists a Repository that disappeared as missing, in its Group", async () => {
  const gone = repository("gone", { groupId: "work" });
  const user = userEvent.setup();
  const api = createStubCoreApi({ [gone.path]: tabOf(gone) }, {}, {}, {}, {}, undefined, { registry: [gone], groups: [work] });
  api.loseRepository(gone.path);
  renderApp({ api });

  await user.click(screen.getByRole("button", { name: "Repositories" }));
  await showTab(user, "Work");

  expect(await panel().findByRole("listitem", { name: "gone" })).toHaveTextContent("missing");
});

it("removes a missing Repository from the list", async () => {
  const user = userEvent.setup();
  const gone = repository("gone");
  const api = createStubCoreApi({}, {}, {}, {}, {}, undefined, { registry: [gone] });
  api.loseRepository(gone.path);
  renderApp({ api });
  await user.click(screen.getByRole("button", { name: "Repositories" }));

  await user.click(await screen.findByRole("button", { name: "Remove gone" }));

  await vi.waitFor(() =>
    expect(screen.queryByRole("listitem", { name: "gone" })).not.toBeInTheDocument(),
  );
  expect(screen.getByText(/no repositories yet/i)).toBeInTheDocument();
});

it("locates a missing Repository at the folder the user picks", async () => {
  const user = userEvent.setup();
  const gone = repository("gone", { groupId: "work" });
  const moved = repository("moved");
  const api = createStubCoreApi(
    { [moved.path]: tabOf(moved) },
    {},
    {},
    {},
    {},
    undefined,
    { registry: [gone], groups: [work] },
  );
  api.loseRepository(gone.path);
  renderApp({ api, pickFolder: async () => moved.path });
  await user.click(screen.getByRole("button", { name: "Repositories" }));

  await user.click(await screen.findByRole("button", { name: "Locate gone" }));

  const row = await panel().findByRole("listitem", { name: "moved" });
  expect(row).not.toHaveTextContent("missing");
  expect(screen.queryByRole("button", { name: /Locate/ })).not.toBeInTheDocument();
});

it("explains that the picked folder is not a Repository and keeps the Repository missing", async () => {
  const user = userEvent.setup();
  const gone = repository("gone");
  const api = createStubCoreApi({}, {}, {}, {}, {}, undefined, { registry: [gone] });
  api.loseRepository(gone.path);
  renderApp({ api, pickFolder: async () => "C:\\work\\plain" });
  await user.click(screen.getByRole("button", { name: "Repositories" }));

  await user.click(await screen.findByRole("button", { name: "Locate gone" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("C:\\work\\plain is not a Git repository");
  expect(screen.getByRole("listitem", { name: "gone" })).toHaveTextContent("missing");
});

it("does nothing when the folder picker is cancelled while locating", async () => {
  const user = userEvent.setup();
  const gone = repository("gone");
  const api = createStubCoreApi({}, {}, {}, {}, {}, undefined, { registry: [gone] });
  api.loseRepository(gone.path);
  renderApp({ api, pickFolder: async () => null });
  await user.click(screen.getByRole("button", { name: "Repositories" }));

  await user.click(await screen.findByRole("button", { name: "Locate gone" }));

  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.getByRole("listitem", { name: "gone" })).toHaveTextContent("missing");
});

it("closes the Tabs of a Repository found missing", async () => {
  const user = userEvent.setup();
  const app = repository("app");
  const tools = repository("tools");
  const api = createStubCoreApi(
    { [app.path]: tabOf(app), [tools.path]: tabOf(tools) },
    {},
    {},
    {},
    {},
    undefined,
    { registry: [] },
  );
  const folders = [app.path, tools.path];
  renderApp({ api, pickFolder: async () => folders.shift() ?? null });
  await user.click(screen.getByRole("button", { name: /open folder/i }));
  await user.click(screen.getByRole("button", { name: /open folder/i }));
  await vi.waitFor(() => expect(windowTabs()).toHaveLength(2));
  api.loseRepository(tools.path);

  await user.click(screen.getByRole("button", { name: "Repositories" }));

  await vi.waitFor(() => expect(windowTabs()).toHaveLength(1));
  expect(windowTabs()[0]).toHaveTextContent("app");
  expect(windowTabs()[0]).toHaveAttribute("aria-selected", "true");
});

it("closes the Tabs of a Repository that is removed", async () => {
  const user = userEvent.setup();
  const app = repository("app", { missing: false });
  const api = createStubCoreApi({ [app.path]: tabOf(app) }, {}, {}, {}, {}, undefined, { registry: [] });
  renderApp({ api, pickFolder: async () => app.path });
  await user.click(screen.getByRole("button", { name: /open folder/i }));
  await screen.findByRole("tab");
  api.loseRepository(app.path);

  await user.click(screen.getByRole("button", { name: "Repositories" }));
  await user.click(await screen.findByRole("button", { name: "Remove app" }));

  await vi.waitFor(() => expect(screen.queryByRole("tab")).not.toBeInTheDocument());
});
