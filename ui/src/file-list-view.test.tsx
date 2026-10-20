import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  type CommitDetail,
  type CoreApi,
  type FileChange,
  type Settings,
  type WorktreeStatus,
  defaultSettings,
} from "./core/api";
import { commitKey, createStubCoreApi } from "./core/stub";
import { commitRow, localTime, renderApp, sampleTab } from "./test-support";

const worktree = sampleTab.worktreePath;
const commitId = "a".repeat(40);

function change(path: string, kind: FileChange["kind"] = "modified", added = 1, removed = 1) {
  return { path, originalPath: null, kind, added, removed } satisfies FileChange;
}

function detailOf(files: FileChange[]): CommitDetail {
  return {
    id: commitId,
    shortId: commitId.slice(0, 7),
    authorName: "Ada Lovelace",
    authorEmail: "ada@example.com",
    authorTimestamp: localTime(2026, 1, 5, 12),
    message: "Add the parser",
    parents: [],
    files,
  };
}

function withSettings(overrides: Partial<Settings>): Settings {
  return { ...defaultSettings, ...overrides };
}

async function openCommit(files: FileChange[], settings?: Settings) {
  const user = userEvent.setup();
  const api = createStubCoreApi(
    { [worktree]: sampleTab },
    {},
    { [worktree]: [commitRow({ id: commitId, subject: "Add the parser" })] },
    {},
    {},
    undefined,
    { settings },
    { commitDetails: { [commitKey(commitId, 0)]: detailOf(files) } },
  );
  renderApp({ api, pickFolder: async () => worktree });
  await user.click(screen.getByRole("button", { name: /open folder/i }));
  await screen.findByRole("tab");
  await user.click(screen.getByRole("button", { name: "History" }));
  const history = await screen.findByRole("list", { name: "Commit history" });
  await user.click(within(history).getByText("Add the parser"));
  await screen.findByRole("list", { name: "Changed files" });
  return { user, api };
}

const status: WorktreeStatus = {
  conflicts: [],
  staged: [change("src/core/api.ts", "modified", 3, 1), change("README.md", "deleted", 0, 4)],
  unstaged: [change("docs/guide.md", "untracked", 5, 0), change("package.json")],
};

async function openChanges(worktreeStatus: WorktreeStatus, settings?: Settings, wrap = (api: CoreApi) => api) {
  const user = userEvent.setup();
  const api = wrap(
    createStubCoreApi(
      { [worktree]: sampleTab },
      { [worktree]: worktreeStatus },
      {},
      {},
      {},
      undefined,
      { settings },
    ),
  );
  renderApp({ api, pickFolder: async () => worktree });
  await user.click(screen.getByRole("button", { name: /open folder/i }));
  await screen.findByRole("tab");
  await user.click(screen.getByRole("button", { name: "Changes" }));
  await screen.findByRole("list", { name: "Changed files" });
  return { user, api };
}

function listItems() {
  return within(screen.getByRole("list", { name: "Changed files" })).getAllByRole("listitem");
}

function itemsOf(group: string) {
  const items = listItems();
  const start = items.findIndex((item) => item.querySelector("h2")?.textContent === group);
  const next = items.findIndex((item, index) => index > start && item.querySelector("h2"));
  return items.slice(start + 1, next < 0 ? undefined : next);
}

const files = [
  change("src/parser.rs", "modified", 12, 3),
  change("src/lexer/tokens.rs", "added", 7, 0),
  change("README.md", "deleted", 0, 4),
];

describe("the changed files of a commit", () => {
  it("are a tree until they are switched to a flat list", async () => {
    const { user } = await openCommit(files);

    expect(screen.getByRole("button", { name: /^src/ })).toHaveAttribute("aria-expanded", "true");

    await user.click(screen.getByRole("radio", { name: "Flat" }));

    expect(screen.queryByRole("button", { name: /^src/ })).not.toBeInTheDocument();
    const rows = listItems().slice(1);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent("README.md");
    expect(rows[1]).toHaveTextContent("tokens.rs");
    expect(rows[1]).toHaveTextContent("src/lexer");
    expect(rows[2]).toHaveTextContent("parser.rs");
  });

  it("keep their status letters and line counts in the flat list", async () => {
    const { user } = await openCommit(files);

    await user.click(screen.getByRole("radio", { name: "Flat" }));

    const tokens = screen.getByText("tokens.rs").closest("button")!;
    expect(tokens).toHaveTextContent("A");
    expect(tokens).toHaveTextContent("+7");
    expect(tokens).toHaveTextContent("−0");
    expect(within(screen.getByRole("list", { name: "Changed files" })).getByText("README.md").closest("button")).toHaveTextContent("D");
  });

  it("can be selected in the flat list", async () => {
    const { user } = await openCommit(files);
    await user.click(screen.getByRole("radio", { name: "Flat" }));

    await user.click(screen.getByText("tokens.rs"));

    expect(screen.getByText("tokens.rs").closest("button")).toHaveAttribute("aria-current", "true");
  });

  it("go back to a tree when it is chosen again", async () => {
    const { user } = await openCommit(files);
    await user.click(screen.getByRole("radio", { name: "Flat" }));

    await user.click(within(screen.getByRole("radiogroup", { name: "Changed files view" })).getByRole("radio", { name: "Tree" }));

    expect(screen.getByRole("button", { name: /^src/ })).toBeInTheDocument();
  });

  it("open in the view stored as the default for History", async () => {
    await openCommit(files, withSettings({ history: { ...defaultSettings.history, filesView: "flat" } }));

    expect(screen.queryByRole("button", { name: /^src/ })).not.toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Flat" })).toBeChecked();
  });

  it("remember the view that was picked", async () => {
    const { user, api } = await openCommit(files);

    await user.click(screen.getByRole("radio", { name: "Flat" }));

    await waitFor(async () => expect((await api.settings()).history.filesView).toBe("flat"));
  });

  it("stay virtualised in both views", async () => {
    const many = Array.from({ length: 3000 }, (_, index) => change(`src/file-${index}.ts`));
    const { user } = await openCommit(many);

    expect(listItems().length).toBeLessThan(100);

    await user.click(screen.getByRole("radio", { name: "Flat" }));

    expect(listItems().length).toBeLessThan(100);
    expect(listItems().length).toBeGreaterThan(10);
  });
});

describe("the Staged and Unstaged files", () => {
  it("switch to a flat list from a toggle on their own header", async () => {
    const { user } = await openChanges(status);

    await user.click(within(listItems()[0]!).getByRole("radio", { name: "Flat" }));

    expect(itemsOf("Staged").map((item) => item.textContent)).toEqual([
      expect.stringContaining("README.md"),
      expect.stringContaining("api.ts"),
    ]);
    expect(itemsOf("Staged")[1]).toHaveTextContent("src/core");
  });

  it("offer a toggle on both lists", async () => {
    await openChanges(status);

    expect(screen.getByRole("radiogroup", { name: "Staged view" })).toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: "Unstaged view" })).toBeInTheDocument();
  });

  it("keep status letters, counts and the stage buttons in the flat list", async () => {
    const { user } = await openChanges(status);
    await user.click(within(screen.getByRole("radiogroup", { name: "Unstaged view" })).getByRole("radio", { name: "Flat" }));

    const guide = itemsOf("Unstaged").find((item) => item.textContent?.includes("guide.md"))!;
    expect(guide).toHaveTextContent("U");
    expect(guide).toHaveTextContent("+5");
    await user.click(within(guide).getByRole("button", { name: "Stage docs/guide.md" }));

    expect(itemsOf("Staged").some((item) => item.textContent?.includes("guide.md"))).toBe(true);
  });

  it("select a file of the flat list", async () => {
    const { user } = await openChanges(status);
    await user.click(within(screen.getByRole("radiogroup", { name: "Unstaged view" })).getByRole("radio", { name: "Flat" }));

    const list = within(screen.getByRole("list", { name: "Changed files" }));
    await user.click(list.getByText("package.json"));

    expect(list.getByText("package.json").closest("button")).toHaveAttribute("aria-current", "true");
  });

  it("open in the view stored as the default for Changes", async () => {
    await openChanges(status, withSettings({ changes: { filesView: "flat" } }));

    expect(screen.queryByRole("button", { name: /^src/ })).not.toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: "Staged view" })).toBeInTheDocument();
  });

  it("remember the view that was picked", async () => {
    const { user, api } = await openChanges(status);

    await user.click(within(screen.getByRole("radiogroup", { name: "Staged view" })).getByRole("radio", { name: "Flat" }));

    await waitFor(async () => expect((await api.settings()).changes.filesView).toBe("flat"));
  });

  it("have no toggle on the Conflicts list", async () => {
    await openChanges({ ...status, conflicts: [change("src/App.tsx", "conflicted")] });

    expect(screen.queryByRole("radiogroup", { name: "Conflicts view" })).not.toBeInTheDocument();
  });

  it("stay virtualised in both views", async () => {
    const many = Array.from({ length: 3000 }, (_, index) => change(`src/file-${index}.ts`));
    const { user } = await openChanges({ conflicts: [], staged: many, unstaged: [] });

    expect(listItems().length).toBeLessThan(100);

    await user.click(screen.getByRole("radio", { name: "Flat" }));

    expect(listItems().length).toBeLessThan(100);
    expect(listItems().length).toBeGreaterThan(10);
  });
});
