import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderApp } from "./test-support";

const viewNames = [
  "Home",
  "History",
  "Changes",
  "Conflicts",
  "Branches",
  "Stashes",
  "Worktrees",
  "Pull requests",
  "Repositories",
  "Settings",
];

const emptyViewNames = viewNames.filter(
  (name) => !["Settings", "History", "Repositories", "Branches", "Conflicts", "Stashes", "Worktrees", "Home"].includes(name),
);

function renderSidebar() {
  renderApp();
  return within(screen.getByRole("navigation", { name: "Views" }));
}

it("lists every view in the sidebar", () => {
  const sidebar = renderSidebar();

  expect(sidebar.getAllByRole("button").map((button) => button.textContent)).toEqual(viewNames);
});

it("starts on the Home view", () => {
  const sidebar = renderSidebar();

  expect(sidebar.getByRole("button", { name: "Home" })).toHaveAttribute("aria-current", "page");
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Home");
});

it.each(emptyViewNames)("shows the empty %s view when it is selected", async (name) => {
  const user = userEvent.setup();
  const sidebar = renderSidebar();

  await user.click(sidebar.getByRole("button", { name }));

  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(name);
  expect(sidebar.getByRole("button", { name })).toHaveAttribute("aria-current", "page");
  expect(screen.getByRole("main")).toHaveTextContent("Nothing here yet");
});

it("shows the Repositories view when it is selected", async () => {
  const user = userEvent.setup();
  const sidebar = renderSidebar();

  await user.click(sidebar.getByRole("button", { name: "Repositories" }));

  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Repositories");
  expect(sidebar.getByRole("button", { name: "Repositories" })).toHaveAttribute(
    "aria-current",
    "page",
  );
});

it("marks only the selected view as current", async () => {
  const user = userEvent.setup();
  const sidebar = renderSidebar();

  await user.click(sidebar.getByRole("button", { name: "Stashes" }));

  expect(sidebar.getByRole("button", { name: "Home" })).not.toHaveAttribute("aria-current");
});
