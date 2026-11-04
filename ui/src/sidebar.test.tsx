import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { type CoreApi, defaultSettings } from "./core/api";
import { createStubCoreApi } from "./core/stub";
import { renderApp } from "./test-support";

const viewOrder = [
  "Home",
  "History",
  "Changes",
  "Pull requests",
  "Conflicts",
  "Worktrees",
  "Branches",
  "Stashes",
  "Tags",
  "Remotes",
  "Repositories",
  "Settings",
];

function sidebar() {
  return within(screen.getByRole("navigation", { name: "Views" }));
}

function toggle() {
  return screen.getByRole("button", { name: /^(Collapse|Expand) sidebar$/ });
}

async function renderCollapsed(api: CoreApi = createStubCoreApi()) {
  const user = userEvent.setup();
  renderApp({ api });
  await user.click(await screen.findByRole("button", { name: "Collapse sidebar" }));
  return { user, api };
}

it("lists the views in the order Home, History, Changes, Pull requests, Conflicts, Worktrees, Branches, Stashes, Tags, Remotes, Repositories, Settings", () => {
  renderApp();

  expect(sidebar().getAllByRole("button").map((button) => button.textContent)).toEqual(viewOrder);
});

it("groups the views as Home | History, Changes, Pull requests, Conflicts | Worktrees, Branches, Stashes, Tags, Remotes | Repositories, Settings", () => {
  renderApp();

  const groups = sidebar()
    .getAllByRole("group")
    .map((group) => within(group).getAllByRole("button").map((button) => button.textContent));

  expect(groups).toEqual([
    ["Home"],
    ["History", "Changes", "Pull requests", "Conflicts"],
    ["Worktrees", "Branches", "Stashes", "Tags", "Remotes"],
    ["Repositories", "Settings"],
  ]);
});

it("draws a separator line between the groups", () => {
  renderApp();

  expect(screen.getAllByRole("separator")).toHaveLength(3);
});

it("gives every view an icon", () => {
  renderApp();

  for (const button of sidebar().getAllByRole("button")) {
    expect(button.querySelector("svg")).not.toBeNull();
  }
});

it("starts expanded, with the labels showing", () => {
  renderApp();

  expect(toggle()).toHaveAccessibleName("Collapse sidebar");
  expect(toggle()).toHaveAttribute("aria-expanded", "true");
  expect(sidebar().getByRole("button", { name: "History" })).toHaveTextContent("History");
});

it("collapses to icons only, which keep their names reachable", async () => {
  await renderCollapsed();

  for (const name of viewOrder) {
    const button = sidebar().getByRole("button", { name });
    expect(button).toHaveTextContent("");
    expect(button.querySelector("svg")).not.toBeNull();
  }
  expect(toggle()).toHaveAccessibleName("Expand sidebar");
  expect(toggle()).toHaveAttribute("aria-expanded", "false");
});

it("labels each icon with a tooltip while collapsed", async () => {
  await renderCollapsed();

  for (const name of viewOrder) {
    expect(sidebar().getByRole("button", { name })).toHaveAttribute("title", name);
  }
});

it("expands again with the same toggle", async () => {
  const { user } = await renderCollapsed();

  await user.click(toggle());

  expect(sidebar().getByRole("button", { name: "History" })).toHaveTextContent("History");
  expect(toggle()).toHaveAccessibleName("Collapse sidebar");
});

it("still reaches every view while collapsed", async () => {
  const { user } = await renderCollapsed();

  for (const name of viewOrder) {
    await user.click(sidebar().getByRole("button", { name }));
    expect(sidebar().getByRole("button", { name })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(name);
  }
});

it("remembers the collapsed state across launches", async () => {
  const { api } = await renderCollapsed();
  expect(await api.settings()).toMatchObject({ appearance: { sidebarCollapsed: true } });

  document.body.innerHTML = "";
  renderApp({ api });

  expect(await screen.findByRole("button", { name: "Expand sidebar" })).toBeInTheDocument();
  expect(sidebar().getByRole("button", { name: "History" })).toHaveTextContent("");
});

it("opens collapsed when the stored settings say so", async () => {
  const api = createStubCoreApi({}, {}, {}, {}, {}, undefined, {
    settings: {
      ...defaultSettings,
      appearance: { ...defaultSettings.appearance, sidebarCollapsed: true },
    },
  });
  renderApp({ api });

  expect(await screen.findByRole("button", { name: "Expand sidebar" })).toBeInTheDocument();
});

it("collapses and expands from the command palette", async () => {
  const user = userEvent.setup();
  renderApp();

  await user.keyboard("{Control>}p{/Control}");
  await user.type(await screen.findByRole("combobox", { name: "Search or run" }), "collapse sidebar");
  await user.keyboard("{Enter}");

  expect(await screen.findByRole("button", { name: "Expand sidebar" })).toBeInTheDocument();

  await user.keyboard("{Control>}p{/Control}");
  await user.type(await screen.findByRole("combobox", { name: "Search or run" }), "expand sidebar");
  await user.keyboard("{Enter}");

  expect(await screen.findByRole("button", { name: "Collapse sidebar" })).toBeInTheDocument();
});
