import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { DiffContent, DiffLine, FileChange, FileDiff, WorktreeStatus } from "./core/api";
import { createStubCoreApi, diffKey } from "./core/stub";
import type { Highlighter } from "./highlight/highlighter";
import { renderApp, sampleTab } from "./test-support";

function change(path: string, kind: FileChange["kind"] = "modified"): FileChange {
  return { path, originalPath: null, kind, added: 1, removed: 1 };
}

function line(kind: DiffLine["kind"], text: string, oldNumber: number | null, newNumber: number | null) {
  return { kind, text, oldNumber, newNumber };
}

function textDiff(path: string, overrides: Partial<FileDiff> = {}): FileDiff {
  return {
    path,
    originalPath: null,
    modeChange: null,
    content: {
      kind: "text",
      hunks: [
        {
          oldStart: 1,
          oldLines: 3,
          newStart: 1,
          newLines: 3,
          lines: [
            line("context", "one", 1, 1),
            line("removed", "two", 2, null),
            line("added", "TWO", null, 2),
            line("context", "three", 3, 3),
          ],
        },
      ],
    },
    ...overrides,
  };
}

function withContent(path: string, content: DiffContent): FileDiff {
  return { path, originalPath: null, modeChange: null, content };
}

const status: WorktreeStatus = {
  conflicts: [],
  staged: [change("src/alpha.txt")],
  unstaged: [change("beta.txt"), change("gamma.txt")],
};

interface OpenOptions {
  status?: WorktreeStatus;
  diffs?: Record<string, FileDiff>;
  highlighter?: Highlighter;
}

async function openChanges({ status: worktreeStatus = status, diffs = {}, highlighter }: OpenOptions = {}) {
  const user = userEvent.setup();
  const api = createStubCoreApi(
    { [sampleTab.worktreePath]: sampleTab },
    { [sampleTab.worktreePath]: worktreeStatus },
    {},
    diffs,
  );
  renderApp({ api, pickFolder: async () => sampleTab.worktreePath, highlighter });
  await user.click(screen.getByRole("button", { name: /open folder/i }));
  await screen.findByRole("tab");
  await user.click(screen.getByRole("button", { name: "Changes" }));
  return { user, api };
}

function diffLines() {
  return within(screen.getByRole("list", { name: "Changed lines" })).getAllByRole("listitem");
}

async function selectFile(user: ReturnType<typeof userEvent.setup>, name: string) {
  const files = screen.getByRole("list", { name: "Changed files" });
  await user.click(within(files).getByText(name));
}

it("shows the diff of the first file as soon as the changes are listed", async () => {
  await openChanges({ diffs: { [diffKey({ list: "staged", path: "src/alpha.txt" })]: textDiff("src/alpha.txt") } });

  const diff = await screen.findByRole("region", { name: "Diff of src/alpha.txt" });

  expect(within(diff).getByText("@@ -1,3 +1,3 @@")).toBeInTheDocument();
  expect(within(diff).getByText("TWO")).toBeInTheDocument();
});

it("shows the line numbers of both sides next to each line", async () => {
  await openChanges({ diffs: { [diffKey({ list: "staged", path: "src/alpha.txt" })]: textDiff("src/alpha.txt") } });
  await screen.findByRole("region", { name: "Diff of src/alpha.txt" });

  const [, context, removed, added] = diffLines();

  expect(context).toHaveTextContent("11 one");
  expect(removed).toHaveTextContent("2−two");
  expect(added).toHaveTextContent("2+TWO");
});

it("computes a diff only for the file that is selected", async () => {
  const { user, api } = await openChanges();
  await screen.findByRole("region", { name: "Diff of src/alpha.txt" });
  expect(api.diffRequests.map(({ path }) => path)).toEqual(["src/alpha.txt"]);

  await selectFile(user, "gamma.txt");

  await screen.findByRole("region", { name: "Diff of gamma.txt" });
  expect(api.diffRequests.map(({ path, list }) => `${list}:${path}`)).toEqual([
    "staged:src/alpha.txt",
    "unstaged:gamma.txt",
  ]);
});

it("keeps showing the diff of the file the user picked when the changes refresh", async () => {
  const { user, api } = await openChanges();
  await screen.findByRole("region", { name: "Diff of src/alpha.txt" });
  await selectFile(user, "gamma.txt");
  await screen.findByRole("region", { name: "Diff of gamma.txt" });

  api.changeWorktree(sampleTab.worktreePath, { ...status, unstaged: [change("gamma.txt")] });

  await waitFor(() => expect(api.diffRequests.length).toBe(3));
  expect(screen.getByRole("region", { name: "Diff of gamma.txt" })).toBeInTheDocument();
});

it("switches between unified and side-by-side modes", async () => {
  const { user } = await openChanges({
    diffs: { [diffKey({ list: "staged", path: "src/alpha.txt" })]: textDiff("src/alpha.txt") },
  });
  await screen.findByRole("region", { name: "Diff of src/alpha.txt" });
  const mode = screen.getByRole("group", { name: "Diff mode" });
  expect(within(mode).getByRole("button", { name: "Unified" })).toHaveAttribute("aria-pressed", "true");
  const unifiedRows = diffLines().length;

  await user.click(within(mode).getByRole("button", { name: "Side by side" }));

  expect(within(mode).getByRole("button", { name: "Side by side" })).toHaveAttribute("aria-pressed", "true");
  expect(diffLines().length).toBe(unifiedRows - 1);
  const replaced = diffLines().find((item) => within(item).queryByText("two"));
  expect(replaced).toHaveTextContent("two");
  expect(replaced).toHaveTextContent("TWO");

  await user.click(within(mode).getByRole("button", { name: "Unified" }));

  expect(diffLines().length).toBe(unifiedRows);
});

it("remembers the chosen mode when another file is selected", async () => {
  const { user } = await openChanges({
    diffs: {
      [diffKey({ list: "staged", path: "src/alpha.txt" })]: textDiff("src/alpha.txt"),
      [diffKey({ list: "unstaged", path: "beta.txt" })]: textDiff("beta.txt"),
    },
  });
  await user.click(await screen.findByRole("button", { name: "Side by side" }));

  await selectFile(user, "beta.txt");

  await screen.findByRole("region", { name: "Diff of beta.txt" });
  expect(screen.getByRole("button", { name: "Side by side" })).toHaveAttribute("aria-pressed", "true");
});

it("collapses a very large file until its diff is asked for", async () => {
  const key = diffKey({ list: "staged", path: "src/alpha.txt" });
  const { user, api } = await openChanges({
    diffs: { [key]: withContent("src/alpha.txt", { kind: "collapsed", bytes: 2_500_000, lines: 30_000 }) },
  });

  const diff = await screen.findByRole("region", { name: "Diff of src/alpha.txt" });

  expect(diff).toHaveTextContent("2.4 MB");
  expect(diff).toHaveTextContent("30,000 lines");
  expect(screen.queryByRole("list", { name: "Changed lines" })).not.toBeInTheDocument();
  expect(api.diffRequests[0]?.loadLarge).toBeFalsy();

  await user.click(within(diff).getByRole("button", { name: "Load diff" }));

  await waitFor(() => expect(api.diffRequests.at(-1)?.loadLarge).toBe(true));
});

it("shows only metadata for a binary file", async () => {
  await openChanges({
    diffs: {
      [diffKey({ list: "staged", path: "src/alpha.txt" })]: withContent("src/alpha.txt", {
        kind: "binary",
        oldBytes: 2048,
        newBytes: 4096,
      }),
    },
  });

  const diff = await screen.findByRole("region", { name: "Diff of src/alpha.txt" });

  expect(diff).toHaveTextContent("Binary file");
  expect(diff).toHaveTextContent("Before: 2.0 KB");
  expect(diff).toHaveTextContent("After: 4.0 KB");
  expect(within(diff).queryByRole("button", { name: "Load diff" })).not.toBeInTheDocument();
});

it("shows a rename and a mode change in the header, even without content changes", async () => {
  await openChanges({
    status: {
      ...status,
      staged: [{ ...change("run.sh", "renamed"), originalPath: "build.sh" }],
    },
    diffs: {
      [diffKey({ list: "staged", path: "run.sh" })]: {
        path: "run.sh",
        originalPath: "build.sh",
        modeChange: { old: "100644", new: "100755" },
        content: { kind: "text", hunks: [] },
      },
    },
  });

  const diff = await screen.findByRole("region", { name: "Diff of run.sh" });

  expect(diff).toHaveTextContent("renamed from build.sh");
  expect(diff).toHaveTextContent("mode 100644 → 100755");
  expect(diff).toHaveTextContent("No content changes.");
});

it("reports a diff that cannot be computed", async () => {
  const api = createStubCoreApi(
    { [sampleTab.worktreePath]: sampleTab },
    { [sampleTab.worktreePath]: status },
  );
  api.fileDiff = async () => {
    throw { kind: "unexpected", message: "the object is missing" };
  };
  const user = userEvent.setup();
  renderApp({ api, pickFolder: async () => sampleTab.worktreePath });
  await user.click(screen.getByRole("button", { name: /open folder/i }));
  await screen.findByRole("tab");
  await user.click(screen.getByRole("button", { name: "Changes" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("the object is missing");
});

describe("syntax highlighting", () => {
  const tsDiff = { [diffKey({ list: "staged", path: "src/app.ts" })]: textDiff("src/app.ts") };
  const tsStatus = { ...status, staged: [change("src/app.ts")] };

  it("shows plain text first and then the tokens the highlighter returns", async () => {
    const highlighter: Highlighter = {
      highlight: async (_language, lines) =>
        lines.map((text) => [{ text, kind: text === "TWO" ? ("keyword" as const) : null }]),
    };
    await openChanges({ status: tsStatus, diffs: tsDiff, highlighter });

    await screen.findByText("TWO");

    await waitFor(() => expect(screen.getByText("TWO")).toHaveClass("token-keyword"));
  });

  it("asks for the language of the file and keeps the diff readable if highlighting fails", async () => {
    const highlight = vi.fn<Highlighter["highlight"]>().mockRejectedValue(new Error("no worker"));
    await openChanges({ status: tsStatus, diffs: tsDiff, highlighter: { highlight } });

    expect(await screen.findByText("TWO")).toBeInTheDocument();
    await waitFor(() => expect(highlight).toHaveBeenCalled());
    expect(highlight.mock.calls.every(([language]) => language === "typescript")).toBe(true);
  });

  it("does not highlight files of an unknown language", async () => {
    const highlight = vi.fn<Highlighter["highlight"]>().mockResolvedValue([]);
    await openChanges({ highlighter: { highlight } });

    await screen.findByRole("region", { name: "Diff of src/alpha.txt" });

    expect(highlight).not.toHaveBeenCalled();
  });
});
