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

function section(name: string) {
  return within(screen.getByRole("region", { name }));
}

function sectionNames() {
  return within(screen.getByRole("main"))
    .getAllByRole("region")
    .map((region) => region.getAttribute("aria-label"));
}

it("lists every Repository with its Worktrees nested under it", async () => {
  await openRepositoriesView([repository("app", {}, ["hotfix"]), repository("tools")]);

  const app = await section("Ungrouped").findByRole("listitem", { name: "app" });
  const worktrees = within(app).getAllByRole("listitem", { name: /Worktree/ });
  expect(worktrees).toHaveLength(2);
  expect(worktrees[0]).toHaveTextContent("main");
  expect(worktrees[1]).toHaveTextContent("hotfix");
  expect(worktrees[1]).toHaveTextContent("C:\\work\\app-hotfix");
  expect(section("Ungrouped").getAllByRole("listitem", { name: /^(app|tools)$/ })).toHaveLength(2);
});

it("shows a detached Worktree by its commit", async () => {
  const detached = repository("app");
  detached.worktrees[0]!.head = { kind: "detached", commit: "abc1234" };

  await openRepositoriesView([detached]);

  expect(await screen.findByText(/detached at abc1234/)).toBeInTheDocument();
});

it("puts each Repository under its Group, with the ungrouped ones in a default section last", async () => {
  await openRepositoriesView(
    [
      repository("app", { groupId: "work" }),
      repository("notes", { groupId: "personal" }),
      repository("scratch"),
    ],
    [work, personal],
  );

  await screen.findByRole("region", { name: "Work" });
  expect(sectionNames()).toEqual(["Work", "Personal", "Ungrouped"]);
  expect(section("Work").getByRole("listitem", { name: "app" })).toBeInTheDocument();
  expect(section("Personal").getByRole("listitem", { name: "notes" })).toBeInTheDocument();
  expect(section("Ungrouped").getByRole("listitem", { name: "scratch" })).toBeInTheDocument();
  expect(section("Work").queryByRole("listitem", { name: "scratch" })).not.toBeInTheDocument();
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

  expect(await section("Ungrouped").findByRole("listitem", { name: "app" })).toBeInTheDocument();
});

it("creates a Group", async () => {
  const { user } = await openRepositoriesView([repository("app")]);

  await user.click(await screen.findByRole("button", { name: "New group" }));
  await user.type(screen.getByRole("textbox", { name: "Group name" }), "Work{Enter}");

  expect(await screen.findByRole("region", { name: "Work" })).toBeInTheDocument();
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

it("renames a Group", async () => {
  const { user } = await openRepositoriesView([repository("app", { groupId: "work" })], [work]);

  await user.click(await screen.findByRole("button", { name: "Rename Work" }));
  const field = screen.getByRole("textbox", { name: "Group name" });
  expect(field).toHaveValue("Work");
  await user.clear(field);
  await user.type(field, "Day job{Enter}");

  expect(await screen.findByRole("region", { name: "Day job" })).toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "Work" })).not.toBeInTheDocument();
  expect(section("Day job").getByRole("listitem", { name: "app" })).toBeInTheDocument();
});

it("reorders Groups with the move buttons", async () => {
  const { user } = await openRepositoriesView([], [work, personal]);

  await user.click(await screen.findByRole("button", { name: "Move Personal up" }));

  await vi.waitFor(() => expect(sectionNames()).toEqual(["Personal", "Work", "Ungrouped"]));

  await user.click(screen.getByRole("button", { name: "Move Personal down" }));

  await vi.waitFor(() => expect(sectionNames()).toEqual(["Work", "Personal", "Ungrouped"]));
});

it("cannot move the first Group up or the last Group down", async () => {
  await openRepositoriesView([], [work, personal]);

  expect(await screen.findByRole("button", { name: "Move Work up" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Move Personal down" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Move Work down" })).toBeEnabled();
});

it("moves a Repository into a Group and back to Ungrouped", async () => {
  const { user } = await openRepositoriesView([repository("app")], [work, personal]);
  const mover = await screen.findByRole("combobox", { name: "Move app to group" });

  await user.selectOptions(mover, "Work");

  await vi.waitFor(() =>
    expect(section("Work").getByRole("listitem", { name: "app" })).toBeInTheDocument(),
  );
  expect(section("Ungrouped").queryByRole("listitem", { name: "app" })).not.toBeInTheDocument();

  await user.selectOptions(screen.getByRole("combobox", { name: "Move app to group" }), "Personal");

  await vi.waitFor(() =>
    expect(section("Personal").getByRole("listitem", { name: "app" })).toBeInTheDocument(),
  );
  expect(section("Work").queryByRole("listitem", { name: "app" })).not.toBeInTheDocument();

  await user.selectOptions(
    screen.getByRole("combobox", { name: "Move app to group" }),
    "Ungrouped",
  );

  await vi.waitFor(() =>
    expect(section("Ungrouped").getByRole("listitem", { name: "app" })).toBeInTheDocument(),
  );
});

it("offers Locate and Remove only for a Repository whose folder is gone", async () => {
  await openRepositoriesView([repository("app"), repository("gone", { missing: true, worktrees: [] })]);

  expect(await screen.findByRole("button", { name: "Locate gone" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Remove gone" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Locate app" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Remove app" })).not.toBeInTheDocument();
});

it("lists a Repository that disappeared as missing, in its Group, without Worktrees", async () => {
  const gone = repository("gone", { groupId: "work" });
  const user = userEvent.setup();
  const api = createStubCoreApi({ [gone.path]: tabOf(gone) }, {}, {}, {}, {}, undefined, { registry: [gone], groups: [work] });
  api.loseRepository(gone.path);
  renderApp({ api });

  await user.click(screen.getByRole("button", { name: "Repositories" }));

  const row = await section("Work").findByRole("listitem", { name: "gone" });
  expect(row).toHaveTextContent("missing");
  expect(within(row).queryByRole("listitem")).not.toBeInTheDocument();
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

  const row = await section("Work").findByRole("listitem", { name: "moved" });
  expect(row).not.toHaveTextContent("missing");
  expect(within(row).getAllByRole("listitem")).toHaveLength(1);
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
  await vi.waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(2));
  api.loseRepository(tools.path);

  await user.click(screen.getByRole("button", { name: "Repositories" }));

  await vi.waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(1));
  expect(screen.getByRole("tab")).toHaveTextContent("app");
  expect(screen.getByRole("tab")).toHaveAttribute("aria-selected", "true");
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
