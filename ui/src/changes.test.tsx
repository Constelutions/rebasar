import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { FileChange, WorktreeStatus } from "./core/api";
import { createStubCoreApi } from "./core/stub";
import { renderApp, sampleTab } from "./test-support";

function change(path: string, kind: FileChange["kind"], added: number, removed: number): FileChange {
  return { path, originalPath: null, kind, added, removed };
}

const status: WorktreeStatus = {
  conflicts: [{ ...change("src/App.tsx", "conflicted", 0, 0), added: null, removed: null }],
  staged: [
    change("src/core/api.ts", "modified", 3, 1),
    change("src/core/stub.ts", "added", 10, 0),
    change("README.md", "deleted", 0, 4),
  ],
  unstaged: [change("docs/guide.md", "untracked", 5, 0), change("package.json", "modified", 1, 1)],
};

async function openChanges(worktreeStatus: WorktreeStatus = status) {
  const user = userEvent.setup();
  const api = createStubCoreApi(
    { [sampleTab.worktreePath]: sampleTab },
    { [sampleTab.worktreePath]: worktreeStatus },
  );
  renderApp({ api, pickFolder: async () => sampleTab.worktreePath });
  await user.click(screen.getByRole("button", { name: /open folder/i }));
  await screen.findByRole("tab");
  await user.click(screen.getByRole("button", { name: "Changes" }));
  return { user, api };
}

function treeRows() {
  return within(screen.getByRole("list", { name: "Changed files" })).getAllByRole("listitem");
}

function groupRows(name: string) {
  const rows = treeRows();
  const start = rows.findIndex((item) => item.querySelector("h2")?.textContent === name);
  if (start < 0) return [];
  const next = rows.findIndex((item, index) => index > start && item.querySelector("h2"));
  return rows.slice(start + 1, next < 0 ? undefined : next);
}

function row(group: string, text: string) {
  const found = groupRows(group).find((item) => within(item).queryByText(text));
  if (!found) throw new Error(`no row for ${text} in ${group}`);
  return found;
}

function hasRow(group: string, text: string) {
  return groupRows(group).some((item) => within(item).queryByText(text));
}

it("groups the files into Conflicts, Staged and Unstaged", async () => {
  await openChanges();
  await screen.findByRole("list", { name: "Changed files" });

  expect(hasRow("Conflicts", "App.tsx")).toBe(true);
  expect(hasRow("Staged", "stub.ts")).toBe(true);
  expect(hasRow("Unstaged", "guide.md")).toBe(true);
  expect(hasRow("Staged", "guide.md")).toBe(false);
});

it("shows each file with its status letter and its added and removed counts", async () => {
  await openChanges();
  await screen.findByRole("list", { name: "Changed files" });

  const stub = row("Staged", "stub.ts");
  expect(stub).toHaveTextContent("A");
  expect(stub).toHaveTextContent("+10");
  expect(stub).toHaveTextContent("−0");

  const readme = row("Staged", "README.md");
  expect(readme).toHaveTextContent("D");
  expect(readme).toHaveTextContent("−4");

  expect(row("Unstaged", "guide.md")).toHaveTextContent("U");
  expect(row("Staged", "api.ts")).toHaveTextContent("M");
});

it("shows files inside folders and totals the counts on each folder", async () => {
  await openChanges();
  await screen.findByRole("list", { name: "Changed files" });

  const src = within(row("Staged", "src")).getByRole("button");
  expect(src).toHaveTextContent("+13");
  expect(src).toHaveTextContent("−1");
  expect(within(row("Staged", "core")).getByRole("button")).toHaveTextContent("+13");
  expect(hasRow("Staged", "stub.ts")).toBe(true);
});

it("collapses and expands a folder", async () => {
  const { user } = await openChanges();
  await screen.findByRole("list", { name: "Changed files" });
  const folder = () => within(row("Staged", "src")).getByRole("button");

  await user.click(folder());

  expect(folder()).toHaveAttribute("aria-expanded", "false");
  expect(hasRow("Staged", "stub.ts")).toBe(false);

  await user.click(folder());

  expect(hasRow("Staged", "stub.ts")).toBe(true);
});

it("lists folders before files", async () => {
  await openChanges();
  await screen.findByRole("list", { name: "Changed files" });

  const names = groupRows("Staged").map((item) => item.textContent ?? "");

  expect(names[0]).toMatch(/^src/);
  expect(names.at(-1)).toMatch(/README\.md/);
});

it("shows no counts for a binary file", async () => {
  await openChanges({
    ...status,
    unstaged: [{ ...change("logo.png", "untracked", 0, 0), added: null, removed: null }],
  });
  await screen.findByRole("list", { name: "Changed files" });

  const logo = row("Unstaged", "logo.png");

  expect(logo).toHaveTextContent("U");
  expect(logo).not.toHaveTextContent("+");
});

it("shows where a renamed file came from", async () => {
  await openChanges({
    ...status,
    staged: [{ ...change("src/new.ts", "renamed", 0, 0), originalPath: "src/old.ts" }],
  });
  await screen.findByRole("list", { name: "Changed files" });

  const renamed = row("Staged", "new.ts");

  expect(renamed).toHaveTextContent("R");
  expect(renamed).toHaveTextContent("src/old.ts");
});

it("omits groups that have no files", async () => {
  await openChanges({ ...status, conflicts: [] });
  await screen.findByRole("list", { name: "Changed files" });

  expect(groupRows("Conflicts")).toEqual([]);
  expect(screen.queryByRole("heading", { name: "Conflicts" })).not.toBeInTheDocument();
});

it("says so when the Worktree is clean", async () => {
  await openChanges({ conflicts: [], staged: [], unstaged: [] });

  expect(await screen.findByText(/no changes/i)).toBeInTheDocument();
});

it("refreshes by itself when the core reports a change made outside the app", async () => {
  const { api } = await openChanges({ conflicts: [], staged: [], unstaged: [] });
  await screen.findByText(/no changes/i);

  api.changeWorktree(sampleTab.worktreePath, {
    conflicts: [],
    staged: [],
    unstaged: [change("from-terminal.txt", "untracked", 2, 0)],
  });

  await screen.findByRole("list", { name: "Changed files" });
  expect(hasRow("Unstaged", "from-terminal.txt")).toBe(true);
  expect(screen.queryByText(/no changes/i)).not.toBeInTheDocument();
});

it("starts watching a Worktree as soon as its Tab is opened", async () => {
  const { api } = await openChanges();

  expect([...api.watchedWorktrees]).toEqual([sampleTab.worktreePath]);
});

it("renders only the rows in view when thousands of files changed", async () => {
  const many = Array.from({ length: 5000 }, (_, index) =>
    change(`src/file-${String(index).padStart(4, "0")}.ts`, "modified", 1, 1),
  );
  await openChanges({ conflicts: [], staged: [], unstaged: many });
  await screen.findByRole("list", { name: "Changed files" });

  expect(treeRows().length).toBeLessThan(100);
  expect(hasRow("Unstaged", "file-0000.ts")).toBe(true);
  expect(hasRow("Unstaged", "file-4999.ts")).toBe(false);
});

it("renders the rows that scroll into view", async () => {
  const many = Array.from({ length: 5000 }, (_, index) =>
    change(`file-${String(index).padStart(4, "0")}.ts`, "modified", 1, 1),
  );
  await openChanges({ conflicts: [], staged: [], unstaged: many });
  const list = await screen.findByRole("list", { name: "Changed files" });

  list.scrollTop = 4950 * 26;
  fireEvent.scroll(list);

  expect(within(list).getByText("file-4950.ts")).toBeInTheDocument();
  expect(within(list).queryByText("file-0000.ts")).not.toBeInTheDocument();
});
