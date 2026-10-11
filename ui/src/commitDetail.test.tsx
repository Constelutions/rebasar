import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { CommitDetail, DiffContent, FileChange, FileDiff } from "./core/api";
import { commitDiffKey, commitKey, createStubCoreApi } from "./core/stub";
import { commitRow, localTime, renderApp, sampleTab } from "./test-support";

const worktree = sampleTab.worktreePath;
const commitId = "a".repeat(40);
const firstParentId = "b".repeat(40);
const secondParentId = "c".repeat(40);

function change(path: string, overrides: Partial<FileChange> = {}): FileChange {
  return { path, originalPath: null, kind: "modified", added: 1, removed: 1, ...overrides };
}

function detail(overrides: Partial<CommitDetail> = {}): CommitDetail {
  return {
    id: commitId,
    shortId: commitId.slice(0, 7),
    authorName: "Ada Lovelace",
    authorEmail: "ada@example.com",
    authorTimestamp: localTime(2026, 1, 5, 12),
    message: "Add the parser\n\nIt reads tokens one at a time.",
    parents: [{ id: firstParentId, shortId: firstParentId.slice(0, 7), subject: "Before" }],
    files: [change("src/parser.rs", { added: 12, removed: 3 }), change("README.md")],
    ...overrides,
  };
}

function textDiff(path: string, added: string): FileDiff {
  return {
    path,
    originalPath: null,
    modeChange: null,
    content: {
      kind: "text",
      hunks: [
        {
          oldStart: 1,
          oldLines: 0,
          newStart: 1,
          newLines: 1,
          lines: [{ kind: "added", text: added, oldNumber: null, newNumber: 1 }],
        },
      ],
    },
  };
}

function withContent(path: string, content: DiffContent): FileDiff {
  return { path, originalPath: null, modeChange: null, content };
}

interface OpenOptions {
  details?: Record<string, CommitDetail>;
  diffs?: Record<string, FileDiff>;
}

async function openCommit({ details, diffs = {} }: OpenOptions = {}) {
  const user = userEvent.setup();
  const api = createStubCoreApi(
    { [worktree]: sampleTab },
    {},
    { [worktree]: [commitRow({ id: commitId, subject: "Add the parser" })] },
    {},
    {},
    undefined,
    undefined,
    {
      commitDetails: details ?? { [commitKey(commitId, 0)]: detail() },
      commitDiffs: diffs,
    },
  );
  renderApp({ api, pickFolder: async () => worktree });
  await user.click(screen.getByRole("button", { name: /open folder/i }));
  await screen.findByRole("tab");
  await user.click(screen.getByRole("button", { name: "History" }));
  const history = await screen.findByRole("list", { name: "Commit history" });
  await user.click(within(history).getByText("Add the parser"));
  return { user, api };
}

function detailPane() {
  return screen.findByRole("region", { name: "Commit detail" });
}

function changedFiles(pane: HTMLElement) {
  return within(within(pane).getByRole("list", { name: "Changed files" }));
}

it("shows no detail until a commit is selected", async () => {
  const user = userEvent.setup();
  const api = createStubCoreApi(
    { [worktree]: sampleTab },
    {},
    { [worktree]: [commitRow({ id: commitId })] },
  );
  renderApp({ api, pickFolder: async () => worktree });
  await user.click(screen.getByRole("button", { name: /open folder/i }));
  await screen.findByRole("tab");
  await user.click(screen.getByRole("button", { name: "History" }));
  await screen.findByRole("list", { name: "Commit history" });

  expect(screen.queryByRole("region", { name: "Commit detail" })).not.toBeInTheDocument();
});

it("shows the author, date, full message and parent of the selected commit", async () => {
  await openCommit();

  const pane = await detailPane();
  expect(await within(pane).findByText("Add the parser")).toBeInTheDocument();
  expect(pane).toHaveTextContent("It reads tokens one at a time.");
  expect(pane).toHaveTextContent("Ada Lovelace");
  expect(pane).toHaveTextContent("ada@example.com");
  expect(pane).toHaveTextContent("January 5, 2026");
  expect(pane).toHaveTextContent(commitId.slice(0, 7));
  expect(pane).toHaveTextContent(`${firstParentId.slice(0, 7)} Before`);
});

it("lists the changed files with their status and line counts", async () => {
  await openCommit();

  const files = within(await screen.findByRole("list", { name: "Changed files" }));
  const parser = files.getByText("parser.rs").closest("button")!;
  expect(parser).toHaveTextContent("M");
  expect(parser).toHaveTextContent("+12");
  expect(parser).toHaveTextContent("−3");
  expect(files.getByText("README.md")).toBeInTheDocument();
});

it("shows the diff of the first changed file and switches to another when it is selected", async () => {
  const { user, api } = await openCommit({
    diffs: {
      [commitDiffKey({ commit: commitId, parent: 0, path: "src/parser.rs" })]: textDiff(
        "src/parser.rs",
        "fn parse() {}",
      ),
      [commitDiffKey({ commit: commitId, parent: 0, path: "README.md" })]: textDiff(
        "README.md",
        "# Parser",
      ),
    },
  });

  await waitFor(() =>
    expect(screen.getByRole("list", { name: "Changed lines" })).toHaveTextContent("fn parse() {}"),
  );
  await user.click(within(screen.getByRole("list", { name: "Changed files" })).getByText("README.md"));

  await waitFor(() =>
    expect(screen.getByRole("list", { name: "Changed lines" })).toHaveTextContent("# Parser"),
  );
  expect(api.commitDiffRequests.map((request) => request.path)).toEqual([
    "src/parser.rs",
    "README.md",
  ]);
});

it("collapses a large file until its diff is asked for", async () => {
  const path = "src/parser.rs";
  const { user, api } = await openCommit({
    diffs: {
      [commitDiffKey({ commit: commitId, parent: 0, path })]: withContent(path, {
        kind: "collapsed",
        bytes: 2_000_000,
        lines: null,
      }),
    },
  });

  await user.click(await screen.findByRole("button", { name: "Load diff" }));

  await waitFor(() =>
    expect(api.commitDiffRequests.at(-1)).toMatchObject({ path, loadLarge: true }),
  );
});

it("shows the original path of a renamed file and asks for the diff against it", async () => {
  const renamed = change("src/new.rs", { kind: "renamed", originalPath: "src/old.rs" });
  const { api } = await openCommit({
    details: { [commitKey(commitId, 0)]: detail({ files: [renamed] }) },
  });

  const files = within(await screen.findByRole("list", { name: "Changed files" }));
  expect(files.getByText("src/old.rs")).toBeInTheDocument();
  await waitFor(() =>
    expect(api.commitDiffRequests[0]).toMatchObject({
      path: "src/new.rs",
      originalPath: "src/old.rs",
    }),
  );
});

it("says a root commit has no parents", async () => {
  await openCommit({
    details: { [commitKey(commitId, 0)]: detail({ parents: [], message: "Root" }) },
  });

  expect(await detailPane()).toHaveTextContent("Root commit");
});

describe("a merge commit", () => {
  const mergeDetails = {
    [commitKey(commitId, 0)]: detail({
      parents: [
        { id: firstParentId, shortId: firstParentId.slice(0, 7), subject: "Main work" },
        { id: secondParentId, shortId: secondParentId.slice(0, 7), subject: "Side work" },
      ],
      files: [change("from-side.txt")],
    }),
    [commitKey(commitId, 1)]: detail({
      parents: [
        { id: firstParentId, shortId: firstParentId.slice(0, 7), subject: "Main work" },
        { id: secondParentId, shortId: secondParentId.slice(0, 7), subject: "Side work" },
      ],
      files: [change("from-main.txt")],
    }),
  };

  it("lists its parents and compares with the first by default", async () => {
    const { api } = await openCommit({ details: mergeDetails });

    const pane = await detailPane();
    await within(pane).findByRole("list", { name: "Changed files" });
    expect(changedFiles(pane).getByText("from-side.txt")).toBeInTheDocument();
    expect(pane).toHaveTextContent("Main work");
    expect(pane).toHaveTextContent("Side work");
    expect(within(pane).getByRole("button", { name: /parent 1/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(api.commitDetailRequests).toEqual([[commitId, 0]]);
  });

  it("compares with another parent when it is chosen", async () => {
    const { user, api } = await openCommit({ details: mergeDetails });
    const pane = await detailPane();
    await within(pane).findByRole("list", { name: "Changed files" });

    await user.click(within(pane).getByRole("button", { name: /parent 2/i }));

    await waitFor(() => expect(changedFiles(pane).getByText("from-main.txt")).toBeInTheDocument());
    expect(changedFiles(pane).queryByText("from-side.txt")).not.toBeInTheDocument();
    expect(api.commitDetailRequests.at(-1)).toEqual([commitId, 1]);
    await waitFor(() =>
      expect(api.commitDiffRequests.at(-1)).toMatchObject({ path: "from-main.txt", parent: 1 }),
    );
  });
});

it("offers no choice of parent for a commit with a single parent", async () => {
  await openCommit();

  const pane = await detailPane();
  await within(pane).findByText("Add the parser");
  expect(within(pane).queryByRole("button", { name: /parent 1/i })).not.toBeInTheDocument();
});

it("reports a commit whose detail cannot be read", async () => {
  await openCommit({ details: {} });

  expect(await screen.findByRole("alert")).toHaveTextContent("has no parent number 0");
});

it("closes the detail pane", async () => {
  const { user } = await openCommit();
  await within(await detailPane()).findByText("Add the parser");

  await user.click(screen.getByRole("button", { name: "Close commit detail" }));

  expect(screen.queryByRole("region", { name: "Commit detail" })).not.toBeInTheDocument();
});
