import { screen, within } from "@testing-library/react";
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

function group(name: string) {
  return within(screen.getByRole("region", { name }));
}

function row(scope: ReturnType<typeof group>, text: string) {
  const element = scope.getByText(text).closest("li");
  if (!element) throw new Error(`no row for ${text}`);
  return element;
}

it("groups the files into Conflicts, Staged and Unstaged", async () => {
  await openChanges();

  expect(await screen.findByRole("region", { name: "Conflicts" })).toBeInTheDocument();
  expect(group("Staged").getByText("stub.ts")).toBeInTheDocument();
  expect(group("Unstaged").getByText("guide.md")).toBeInTheDocument();
  expect(group("Conflicts").getByText("App.tsx")).toBeInTheDocument();
  expect(group("Staged").queryByText("guide.md")).not.toBeInTheDocument();
});

it("shows each file with its status letter and its added and removed counts", async () => {
  await openChanges();
  await screen.findByRole("region", { name: "Staged" });

  const stub = row(group("Staged"), "stub.ts");
  expect(stub).toHaveTextContent("A");
  expect(stub).toHaveTextContent("+10");
  expect(stub).toHaveTextContent("−0");

  const readme = row(group("Staged"), "README.md");
  expect(readme).toHaveTextContent("D");
  expect(readme).toHaveTextContent("−4");

  expect(row(group("Unstaged"), "guide.md")).toHaveTextContent("U");
  expect(row(group("Staged"), "api.ts")).toHaveTextContent("M");
});

it("shows files inside folders and totals the counts on each folder", async () => {
  await openChanges();
  await screen.findByRole("region", { name: "Staged" });

  const staged = group("Staged");
  const src = staged.getByRole("button", { name: /^src/ });
  expect(src).toHaveTextContent("+13");
  expect(src).toHaveTextContent("−1");
  expect(staged.getByRole("button", { name: /^core/ })).toHaveTextContent("+13");
  expect(staged.getByText("stub.ts")).toBeInTheDocument();
});

it("collapses and expands a folder", async () => {
  const { user } = await openChanges();
  await screen.findByRole("region", { name: "Staged" });
  const folder = group("Staged").getByRole("button", { name: /^src/ });

  await user.click(folder);

  expect(folder).toHaveAttribute("aria-expanded", "false");
  expect(group("Staged").queryByText("stub.ts")).not.toBeInTheDocument();

  await user.click(folder);

  expect(group("Staged").getByText("stub.ts")).toBeInTheDocument();
});

it("lists folders before files", async () => {
  await openChanges();
  await screen.findByRole("region", { name: "Staged" });

  const names = group("Staged")
    .getAllByRole("listitem")
    .map((item) => item.firstElementChild?.textContent ?? "");

  expect(names[0]).toMatch(/^src/);
  expect(names.at(-1)).toMatch(/README\.md/);
});

it("shows no counts for a binary file", async () => {
  await openChanges({
    ...status,
    unstaged: [{ ...change("logo.png", "untracked", 0, 0), added: null, removed: null }],
  });
  await screen.findByRole("region", { name: "Unstaged" });

  const logo = row(group("Unstaged"), "logo.png");

  expect(logo).toHaveTextContent("U");
  expect(logo).not.toHaveTextContent("+");
});

it("shows where a renamed file came from", async () => {
  await openChanges({
    ...status,
    staged: [{ ...change("src/new.ts", "renamed", 0, 0), originalPath: "src/old.ts" }],
  });
  await screen.findByRole("region", { name: "Staged" });

  const renamed = row(group("Staged"), "new.ts");

  expect(renamed).toHaveTextContent("R");
  expect(renamed).toHaveTextContent("src/old.ts");
});

it("omits groups that have no files", async () => {
  await openChanges({ ...status, conflicts: [] });
  await screen.findByRole("region", { name: "Staged" });

  expect(screen.queryByRole("region", { name: "Conflicts" })).not.toBeInTheDocument();
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

  await screen.findByRole("region", { name: "Unstaged" });
  expect(group("Unstaged").getByText("from-terminal.txt")).toBeInTheDocument();
  expect(screen.queryByText(/no changes/i)).not.toBeInTheDocument();
});

it("starts watching a Worktree as soon as its Tab is opened", async () => {
  const { api } = await openChanges();

  expect([...api.watchedWorktrees]).toEqual([sampleTab.worktreePath]);
});
