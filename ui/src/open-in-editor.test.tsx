import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { type CoreApi, type Editor, type Settings, defaultSettings } from "./core/api";
import { createStubCoreApi } from "./core/stub";
import { renderApp, sampleTab } from "./test-support";

const worktree = sampleTab.worktreePath;

const vscode: Editor = { id: "vscode", label: "VS Code", available: true, unavailableReason: null };
const zed: Editor = { id: "zed", label: "Zed", available: true, unavailableReason: null };

interface OpenOptions {
  editors?: Editor[];
  settings?: Settings;
  wrap?: (api: ReturnType<typeof createStubCoreApi>) => CoreApi;
}

async function open({ editors = [vscode, zed], settings = defaultSettings, wrap = (api) => api }: OpenOptions = {}) {
  const user = userEvent.setup();
  const stub = createStubCoreApi({ [worktree]: sampleTab }, {}, {}, {}, {}, undefined, { editors, settings });
  renderApp({ api: wrap(stub), pickFolder: async () => worktree });
  await user.click(screen.getByRole("button", { name: /open folder/i }));
  await screen.findByRole("tab");
  const group = await screen.findByRole("group", { name: "Open in editor" });
  return { user, api: stub, group };
}

async function openMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Choose editor" }));
  return screen.getByRole("menu", { name: "Editors" });
}

it("opens the Worktree in the first editor with one click when none was used yet", async () => {
  const { user, api, group } = await open();

  await user.click(within(group).getByRole("button", { name: "Open in VS Code" }));

  expect(api.openedInEditor).toEqual([{ editorId: "vscode", path: worktree }]);
});

it("lists the editors in the order the platform layer reports them", async () => {
  const { user } = await open();

  const menu = await openMenu(user);

  expect(within(menu).getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["VS Code", "Zed"]);
});

it("opens the Worktree in the editor picked from the menu", async () => {
  const { user, api } = await open();

  const menu = await openMenu(user);
  await user.click(within(menu).getByRole("menuitem", { name: "Zed" }));

  expect(api.openedInEditor).toEqual([{ editorId: "zed", path: worktree }]);
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
});

it("remembers the last editor as the one-click default", async () => {
  const { user, api } = await open();

  const menu = await openMenu(user);
  await user.click(within(menu).getByRole("menuitem", { name: "Zed" }));

  expect(await screen.findByRole("button", { name: "Open in Zed" })).toBeInTheDocument();
  await waitFor(async () => expect((await api.settings()).editor.lastUsed).toBe("zed"));
});

it("starts with the editor remembered from the last run as the default", async () => {
  const { user, api } = await open({ settings: { ...defaultSettings, editor: { lastUsed: "zed" } } });

  await user.click(await screen.findByRole("button", { name: "Open in Zed" }));

  expect(api.openedInEditor).toEqual([{ editorId: "zed", path: worktree }]);
});

it("disables an editor that is not on the PATH and gives the reason in a tooltip", async () => {
  const missing = { ...zed, available: false, unavailableReason: "The zed command was not found on the PATH." };
  const { user } = await open({ editors: [vscode, missing] });

  const menu = await openMenu(user);

  const item = within(menu).getByRole("menuitem", { name: "Zed" });
  expect(item).toBeDisabled();
  expect(item).toHaveAttribute("title", "The zed command was not found on the PATH.");
});

it("falls back to an editor that can be used when the remembered one cannot", async () => {
  const missing = { ...zed, available: false, unavailableReason: "The zed command was not found on the PATH." };

  await open({ editors: [vscode, missing], settings: { ...defaultSettings, editor: { lastUsed: "zed" } } });

  expect(await screen.findByRole("button", { name: "Open in VS Code" })).toBeEnabled();
});

it("disables the one-click action when no editor can be used", async () => {
  const missing = { ...vscode, available: false, unavailableReason: "The code command was not found on the PATH." };
  const { group } = await open({ editors: [missing] });

  expect(within(group).getByRole("button", { name: "Open in editor" })).toBeDisabled();
});

it("reports a failure to start the editor and does not remember the choice", async () => {
  const { user, api } = await open({
    wrap: (stub) => ({ ...stub, openInEditor: async () => Promise.reject({ kind: "unexpected", message: "could not start Zed" }) }),
  });

  const menu = await openMenu(user);
  await user.click(within(menu).getByRole("menuitem", { name: "Zed" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("could not start Zed");
  expect((await api.settings()).editor.lastUsed).toBeNull();
});

it("offers an editor in the command palette for the Worktree in front", async () => {
  const { user, api } = await open();

  await user.keyboard("{Control>}p{/Control}");
  await user.keyboard("Open Worktree in Zed");
  await user.keyboard("{Enter}");

  await waitFor(() => expect(api.openedInEditor).toEqual([{ editorId: "zed", path: worktree }]));
});
