import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  type CommitDetail,
  type Editor,
  type FileChange,
  type Settings,
  type WorktreeStatus,
  defaultSettings,
} from "./core/api";
import { commitKey, createStubCoreApi } from "./core/stub";
import { commitRow, localTime, renderApp, sampleTab } from "./test-support";

const worktree = sampleTab.worktreePath;
const commitId = "a".repeat(40);

const nano: Editor = { id: "nano", label: "Nano", opensFolders: false, available: true, unavailableReason: null };
const notepad: Editor = { id: "notepad", label: "Notepad", opensFolders: false, available: true, unavailableReason: null };
const vscode: Editor = { id: "vscode", label: "VS Code", opensFolders: true, available: true, unavailableReason: null };
const zed: Editor = { id: "zed", label: "Zed", opensFolders: true, available: true, unavailableReason: null };

function change(path: string, kind: FileChange["kind"] = "modified"): FileChange {
  return { path, originalPath: null, kind, added: 1, removed: 1 };
}

const status: WorktreeStatus = {
  conflicts: [],
  staged: [change("src/core/api.ts"), change("README.md", "deleted")],
  unstaged: [change("docs/guide.md", "untracked")],
};

function detail(): CommitDetail {
  return {
    id: commitId,
    shortId: commitId.slice(0, 7),
    authorName: "Ada Lovelace",
    authorEmail: "ada@example.com",
    authorTimestamp: localTime(2026, 1, 5, 12),
    message: "Add the parser",
    parents: [],
    files: [change("src/parser.rs"), change("old.txt", "deleted")],
  };
}

interface OpenOptions {
  editors?: Editor[];
  settings?: Settings;
  wrap?: (api: ReturnType<typeof createStubCoreApi>) => ReturnType<typeof createStubCoreApi>;
}

async function openStub({ editors = [nano, notepad, vscode, zed], settings = defaultSettings }: OpenOptions) {
  const user = userEvent.setup();
  const api = createStubCoreApi(
    { [worktree]: sampleTab },
    { [worktree]: status },
    { [worktree]: [commitRow({ id: commitId, subject: "Add the parser" })] },
    {},
    {},
    undefined,
    { editors, settings },
    { commitDetails: { [commitKey(commitId, 0)]: detail() } },
  );
  return { user, api };
}

async function openChanges(options: OpenOptions = {}) {
  const { user, api } = await openStub(options);
  renderApp({ api: options.wrap?.(api) ?? api, pickFolder: async () => worktree });
  await user.click(screen.getByRole("button", { name: /open folder/i }));
  await screen.findByRole("tab");
  await user.click(screen.getByRole("button", { name: "Changes" }));
  await screen.findByRole("list", { name: "Changed files" });
  return { user, api };
}

async function openHistory(options: OpenOptions = {}) {
  const { user, api } = await openStub(options);
  renderApp({ api, pickFolder: async () => worktree });
  await user.click(screen.getByRole("button", { name: /open folder/i }));
  await screen.findByRole("tab");
  await user.click(screen.getByRole("button", { name: "History" }));
  const history = await screen.findByRole("list", { name: "Commit history" });
  await user.click(within(history).getByText("Add the parser"));
  await screen.findByRole("list", { name: "Changed files" });
  return { user, api };
}

async function openFileMenu(user: ReturnType<typeof userEvent.setup>, path: string) {
  await user.click(await screen.findByRole("button", { name: `Open file in… ${path}` }));
  return screen.getByRole("menu", { name: "Open file in" });
}

it("offers every changed file in a menu of the editors, in the order the platform layer reports them", async () => {
  const { user } = await openChanges();

  const menu = await openFileMenu(user, "docs/guide.md");

  expect(within(menu).getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
    "Nano",
    "Notepad",
    "VS Code",
    "Zed",
  ]);
});

it("opens the file of the row in the editor picked from the menu", async () => {
  const { user, api } = await openChanges();

  const menu = await openFileMenu(user, "src/core/api.ts");
  await user.click(within(menu).getByRole("menuitem", { name: "Nano" }));

  expect(api.openedFilesInEditor).toEqual([{ editorId: "nano", worktreePath: worktree, file: "src/core/api.ts" }]);
  expect(screen.queryByRole("menu", { name: "Open file in" })).not.toBeInTheDocument();
});

it("remembers the editor, which becomes the one-click default of the Worktree button too", async () => {
  const { user, api } = await openChanges();

  const menu = await openFileMenu(user, "docs/guide.md");
  await user.click(within(menu).getByRole("menuitem", { name: "Zed" }));

  expect(await screen.findByRole("button", { name: "Open in Zed" })).toBeInTheDocument();
  await waitFor(async () => expect((await api.settings()).editor.lastUsed).toBe("zed"));
});

it("marks the remembered editor in the menu", async () => {
  const { user } = await openChanges({ settings: { ...defaultSettings, editor: { lastUsed: "notepad" } } });

  const menu = await openFileMenu(user, "docs/guide.md");

  expect(within(menu).getByRole("menuitem", { name: "Notepad" })).toHaveAttribute("aria-current", "true");
  expect(within(menu).getByRole("menuitem", { name: "Nano" })).not.toHaveAttribute("aria-current");
});

it("disables an editor that is not on the PATH and gives the reason in a tooltip", async () => {
  const missing = { ...nano, available: false, unavailableReason: "The nano command was not found on the PATH." };
  const { user } = await openChanges({ editors: [missing, vscode] });

  const menu = await openFileMenu(user, "docs/guide.md");

  const item = within(menu).getByRole("menuitem", { name: "Nano" });
  expect(item).toBeDisabled();
  expect(item).toHaveAttribute("title", "The nano command was not found on the PATH.");
});

it("has nothing to open for a deleted file", async () => {
  await openChanges();

  const button = await screen.findByRole("button", { name: "Open file in… README.md" });

  expect(button).toBeDisabled();
  expect(button).toHaveAttribute("title", "A deleted file has nothing to open.");
});

it("reports a failure to open the file and does not remember the editor", async () => {
  const { user, api } = await openChanges({
    wrap: (stub) =>
      Object.assign(stub, {
        openFileInEditor: async () => Promise.reject({ kind: "unexpected", message: "could not start Nano" }),
      }),
  });

  const menu = await openFileMenu(user, "docs/guide.md");
  await user.click(within(menu).getByRole("menuitem", { name: "Nano" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("could not start Nano");
  expect((await api.settings()).editor.lastUsed).toBeNull();
});

it("closes the menu on Escape", async () => {
  const { user } = await openChanges();

  await openFileMenu(user, "docs/guide.md");
  await user.keyboard("{Escape}");

  expect(screen.queryByRole("menu", { name: "Open file in" })).not.toBeInTheDocument();
});

it("offers the selected file in the command palette", async () => {
  const { user, api } = await openChanges();

  await user.click(screen.getByText("guide.md"));
  await user.keyboard("{Control>}p{/Control}");
  await user.keyboard("Open selected file in Notepad");
  await user.keyboard("{Enter}");

  await waitFor(() =>
    expect(api.openedFilesInEditor).toEqual([{ editorId: "notepad", worktreePath: worktree, file: "docs/guide.md" }]),
  );
});

it("offers the files of a commit in History the same menu", async () => {
  const { user, api } = await openHistory();

  const menu = await openFileMenu(user, "src/parser.rs");
  await user.click(within(menu).getByRole("menuitem", { name: "VS Code" }));

  expect(api.openedFilesInEditor).toEqual([{ editorId: "vscode", worktreePath: worktree, file: "src/parser.rs" }]);
});

it("has nothing to open for a file a commit deleted", async () => {
  await openHistory();

  expect(await screen.findByRole("button", { name: "Open file in… old.txt" })).toBeDisabled();
});
