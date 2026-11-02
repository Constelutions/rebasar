import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  type ConfirmTabClose,
  type FileChange,
  type OperationInProgress,
  type Tab,
  type WorktreeStatus,
  defaultSettings,
} from "./core/api";
import { createStubCoreApi } from "./core/stub";
import { renderApp, sampleTab } from "./test-support";

const other: Tab = {
  repositoryName: "tools",
  worktreePath: "C:\\work\\tools",
  head: { kind: "branch", name: "main" },
};

const staged: FileChange = {
  path: "src/api.ts",
  originalPath: null,
  kind: "modified",
  added: 1,
  removed: 0,
};
const status: WorktreeStatus = { conflicts: [], staged: [staged], unstaged: [] };

const rebase: OperationInProgress = {
  kind: "rebase",
  step: { current: 1, total: 3 },
  conflicts: 1,
  canSkip: true,
};

interface Options {
  confirmClose?: ConfirmTabClose;
  operation?: OperationInProgress;
}

async function openSample({ confirmClose, operation }: Options = {}) {
  const user = userEvent.setup();
  const api = createStubCoreApi(
    { [sampleTab.worktreePath]: sampleTab, [other.worktreePath]: other },
    { [sampleTab.worktreePath]: status },
    {},
    {},
    {},
    undefined,
    {
      settings: confirmClose
        ? { ...defaultSettings, tabs: { ...defaultSettings.tabs, confirmClose } }
        : undefined,
    },
  );
  if (operation) api.setOperation(sampleTab.worktreePath, operation);
  const folders = [other.worktreePath, sampleTab.worktreePath];
  renderApp({ api, pickFolder: async () => folders.shift() ?? null });
  for (let opened = 1; opened <= 2; opened++) {
    await user.click(screen.getByRole("button", { name: /open folder/i }));
    await vi.waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(opened));
  }
  return { user, api };
}

const closeSample = () => screen.getByRole("button", { name: "Close sample · main" });

async function typeMessage(user: ReturnType<typeof userEvent.setup>, text: string) {
  await user.click(screen.getByRole("button", { name: "Changes" }));
  await user.type(await screen.findByRole("textbox", { name: "Commit message" }), text);
}

it("puts a close button on the left of each Tab, before its label and status dot", async () => {
  await openSample();

  const tab = screen.getByRole("tab", { name: /sample/ });
  const group = tab.parentElement!;

  expect(group.firstElementChild).toBe(closeSample());
  expect(group).toContainElement(tab);
});

it("closes a Tab with nothing to lose at once", async () => {
  const { user } = await openSample();

  await user.click(closeSample());

  expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  expect(screen.getAllByRole("tab")).toHaveLength(1);
  expect(screen.getByRole("tab", { name: /tools/ })).toHaveAttribute("aria-selected", "true");
});

it("asks before closing a Tab with an unsent commit message and says what would be lost", async () => {
  const { user } = await openSample();
  await typeMessage(user, "feat: draft");

  await user.click(closeSample());

  const dialog = screen.getByRole("alertdialog", { name: "Close Tab" });
  expect(dialog).toHaveTextContent("sample · main");
  expect(dialog).toHaveTextContent("The commit message you have not committed");
  expect(screen.getAllByRole("tab")).toHaveLength(2);
});

it("keeps the Tab and its message when the closing is cancelled", async () => {
  const { user } = await openSample();
  await typeMessage(user, "feat: draft");
  await user.click(closeSample());

  await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Cancel" }));

  expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  expect(screen.getAllByRole("tab")).toHaveLength(2);
  expect(screen.getByRole("textbox", { name: "Commit message" })).toHaveValue("feat: draft");
});

it("closes the Tab once the loss is confirmed", async () => {
  const { user } = await openSample();
  await typeMessage(user, "feat: draft");
  await user.click(closeSample());

  await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Close" }));

  expect(screen.getAllByRole("tab")).toHaveLength(1);
  expect(screen.queryByRole("tab", { name: /sample/ })).not.toBeInTheDocument();
});

it("still knows about the unsent message after the user moves to another view", async () => {
  const { user } = await openSample();
  await typeMessage(user, "feat: draft");
  await user.click(screen.getByRole("button", { name: "History" }));

  await user.click(closeSample());

  expect(screen.getByRole("alertdialog")).toHaveTextContent("The commit message you have not committed");
});

it("asks before closing a Tab with an Operation in progress and names it", async () => {
  const { user } = await openSample({ operation: rebase });
  await vi.waitFor(() => expect(screen.getByRole("region", { name: "Operation in progress" })));

  await user.click(closeSample());

  expect(screen.getByRole("alertdialog")).toHaveTextContent("The rebase in progress");
  expect(screen.getAllByRole("tab")).toHaveLength(2);
});

it("names everything that would be lost together", async () => {
  const { user } = await openSample({ operation: rebase });
  await typeMessage(user, "feat: draft");

  await user.click(closeSample());

  const dialog = screen.getByRole("alertdialog");
  expect(dialog).toHaveTextContent("The commit message you have not committed");
  expect(dialog).toHaveTextContent("The rebase in progress");
});

it("asks even when nothing would be lost if the setting is Always", async () => {
  const { user } = await openSample({ confirmClose: "always" });

  await user.click(closeSample());

  expect(screen.getByRole("alertdialog")).toHaveTextContent("Close sample · main?");
  expect(screen.getAllByRole("tab")).toHaveLength(2);

  await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Close" }));
  expect(screen.getAllByRole("tab")).toHaveLength(1);
});

it("never asks if the setting is Never, even with something to lose", async () => {
  const { user } = await openSample({ confirmClose: "never", operation: rebase });
  await typeMessage(user, "feat: draft");

  await user.click(closeSample());

  expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  expect(screen.getAllByRole("tab")).toHaveLength(1);
});

it("closes the Tab in front from the command palette", async () => {
  const { user } = await openSample();

  await user.keyboard("{Control>}p{/Control}");
  await user.type(await screen.findByRole("combobox", { name: "Search or run" }), "close tab");
  await user.keyboard("{Enter}");

  expect(screen.getAllByRole("tab")).toHaveLength(1);
  expect(screen.queryByRole("tab", { name: /sample/ })).not.toBeInTheDocument();
});

it("lets the user choose when closing a Tab asks and whether Tabs come back on launch", async () => {
  const { user, api } = await openSample();
  await user.click(screen.getByRole("button", { name: "Settings" }));

  await user.selectOptions(screen.getByLabelText("Confirm before closing a Tab"), "never");
  await user.click(screen.getByRole("checkbox", { name: "Restore Tabs on launch" }));

  await vi.waitFor(async () =>
    expect((await api.settings()).tabs).toEqual({ confirmClose: "never", restoreOnLaunch: false }),
  );
});

it("offers Always, When something would be lost and Never, defaulting to the middle one", async () => {
  const { user } = await openSample();
  await user.click(screen.getByRole("button", { name: "Settings" }));

  const select = screen.getByLabelText("Confirm before closing a Tab");

  expect(within(select).getAllByRole("option").map((option) => option.textContent)).toEqual([
    "Always",
    "When something would be lost",
    "Never",
  ]);
  expect(select).toHaveValue("whenLost");
  expect(screen.getByRole("checkbox", { name: "Restore Tabs on launch" })).toBeChecked();
});
