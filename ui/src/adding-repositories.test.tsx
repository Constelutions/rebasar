import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { Group } from "./core/api";
import { createStubCoreApi } from "./core/stub";
import { renderApp } from "./test-support";

const work: Group = { id: "work", name: "Work" };

async function openRepositoriesView(folder: string | null = "C:\\code", groups: Group[] = []) {
  const user = userEvent.setup();
  const api = createStubCoreApi({}, {}, {}, {}, {}, undefined, { groups });
  renderApp({ api, pickFolder: async () => folder });
  await user.click(screen.getByRole("button", { name: "Repositories" }));
  return { user, api };
}

function dialog() {
  return within(screen.getByRole("dialog"));
}

it("clones a URL into the chosen folder, opens it as a Tab and lists it", async () => {
  const { user, api } = await openRepositoriesView("C:\\code", [work]);

  await user.click(screen.getByRole("button", { name: "Clone…" }));
  await user.type(dialog().getByLabelText("Repository URL"), "https://example.com/team/app.git");
  await user.click(dialog().getByRole("button", { name: "Choose folder…" }));
  await user.selectOptions(dialog().getByLabelText("Group"), "Work");
  await user.click(dialog().getByRole("button", { name: "Clone" }));

  expect(await screen.findByRole("tab", { name: /app/ })).toBeInTheDocument();
  expect(api.added).toEqual([
    { how: "clone", source: "https://example.com/team/app.git", groupId: "work" },
  ]);
  expect(await within(screen.getByRole("region", { name: "Work" })).findByText("app")).toBeInTheDocument();
});

it("cannot clone before a URL and a folder are given", async () => {
  const { user } = await openRepositoriesView();

  await user.click(screen.getByRole("button", { name: "Clone…" }));

  expect(dialog().getByRole("button", { name: "Clone" })).toBeDisabled();
});

it("shows why a clone failed", async () => {
  const { user } = await openRepositoriesView();

  await user.click(screen.getByRole("button", { name: "Clone…" }));
  await user.type(dialog().getByLabelText("Repository URL"), "https://unreachable.example/app.git");
  await user.click(dialog().getByRole("button", { name: "Choose folder…" }));
  await user.click(dialog().getByRole("button", { name: "Clone" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("Could not reach the server");
});

it("initialises a folder as a Repository and opens it", async () => {
  const { user, api } = await openRepositoriesView("C:\\code\\fresh");

  await user.click(screen.getByRole("button", { name: "Initialise…" }));
  await user.click(dialog().getByRole("button", { name: "Choose folder…" }));
  await user.click(dialog().getByRole("button", { name: "Initialise" }));

  expect(await screen.findByRole("tab", { name: /fresh/ })).toBeInTheDocument();
  expect(api.added).toEqual([{ how: "init", source: "C:\\code\\fresh", groupId: null }]);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("keeps the dialog open and explains when the folder is a Repository already", async () => {
  const { user } = await openRepositoriesView("C:\\code\\fresh");
  for (let attempt = 0; attempt < 2; attempt++) {
    await user.click(screen.getByRole("button", { name: "Initialise…" }));
    await user.click(dialog().getByRole("button", { name: "Choose folder…" }));
    await user.click(dialog().getByRole("button", { name: "Initialise" }));
    if (attempt === 0) await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  }

  expect(await dialog().findByRole("alert")).toHaveTextContent("is already a Git repository");
});

it("lists what a scan finds and imports only the selected Repositories", async () => {
  const { user, api } = await openRepositoriesView("C:\\code", [work]);
  api.setScanResults("C:\\code", [
    { path: "C:\\code\\alpha", name: "alpha", alreadyAdded: false },
    { path: "C:\\code\\beta", name: "beta", alreadyAdded: false },
    { path: "C:\\code\\gamma", name: "gamma", alreadyAdded: true },
  ]);

  await user.click(screen.getByRole("button", { name: "Scan folder…" }));
  await user.click(dialog().getByRole("button", { name: "Choose folder…" }));
  const found = await dialog().findByRole("list", { name: "Repositories found" });
  expect(within(found).getByRole("checkbox", { name: /gamma/ })).toBeDisabled();
  await user.click(within(found).getByRole("checkbox", { name: /beta/ }));
  await user.selectOptions(dialog().getByLabelText("Group"), "Work");
  await user.click(dialog().getByRole("button", { name: "Import selected" }));

  await waitFor(() =>
    expect(api.added).toEqual([{ how: "import", source: "C:\\code\\alpha", groupId: "work" }]),
  );
  expect(await within(screen.getByRole("region", { name: "Work" })).findByText("alpha")).toBeInTheDocument();
  expect(screen.queryByRole("tab")).not.toBeInTheDocument();
});

it("says so when a scan finds nothing", async () => {
  const { user } = await openRepositoriesView();

  await user.click(screen.getByRole("button", { name: "Scan folder…" }));
  await user.click(dialog().getByRole("button", { name: "Choose folder…" }));

  expect(await dialog().findByText("No Repositories found in that folder.")).toBeInTheDocument();
  expect(dialog().getByRole("button", { name: "Import selected" })).toBeDisabled();
});

it("closes the dialog on Cancel without adding anything", async () => {
  const { user, api } = await openRepositoriesView();

  await user.click(screen.getByRole("button", { name: "Initialise…" }));
  await user.click(dialog().getByRole("button", { name: "Cancel" }));

  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(api.added).toEqual([]);
});

it("offers the three ways of adding in the command palette", async () => {
  const user = userEvent.setup();
  renderApp({ api: createStubCoreApi() });

  await user.keyboard("{Control>}p{/Control}");
  await user.type(screen.getByRole("combobox"), "clone repo");
  await user.keyboard("{Enter}");

  expect(await screen.findByRole("dialog", { name: "Clone a Repository" })).toBeInTheDocument();
});
