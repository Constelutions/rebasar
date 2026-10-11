import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { DiffLine, FileChange, FileDiff, WorktreeStatus } from "./core/api";
import { createStubCoreApi, diffKey } from "./core/stub";
import { renderApp, sampleTab } from "./test-support";

function change(path: string): FileChange {
  return { path, originalPath: null, kind: "modified", added: 3, removed: 1 };
}

function line(kind: DiffLine["kind"], text: string, oldNumber: number | null, newNumber: number | null) {
  return { kind, text, oldNumber, newNumber };
}

const twoHunks: FileDiff = {
  path: "notes.txt",
  originalPath: null,
  modeChange: null,
  content: {
    kind: "text",
    hunks: [
      {
        oldStart: 1,
        oldLines: 2,
        newStart: 1,
        newLines: 3,
        lines: [line("context", "one", 1, 1), line("added", "one and a half", null, 2), line("added", "one and three quarters", null, 3)],
      },
      {
        oldStart: 20,
        oldLines: 2,
        newStart: 21,
        newLines: 2,
        lines: [line("context", "twenty", 20, 21), line("removed", "old", 21, null), line("added", "new", null, 22)],
      },
    ],
  },
};

async function openChanges(status: WorktreeStatus, diffs: Record<string, FileDiff>) {
  const user = userEvent.setup();
  const api = createStubCoreApi(
    { [sampleTab.worktreePath]: sampleTab },
    { [sampleTab.worktreePath]: status },
    {},
    diffs,
  );
  renderApp({ api, pickFolder: async () => sampleTab.worktreePath });
  await user.click(screen.getByRole("button", { name: /open folder/i }));
  await screen.findByRole("tab");
  await user.click(screen.getByRole("button", { name: "Changes" }));
  return { user, api };
}

const unstaged: WorktreeStatus = { conflicts: [], staged: [], unstaged: [change("notes.txt")] };
const staged: WorktreeStatus = { conflicts: [], staged: [change("notes.txt")], unstaged: [] };

it("stages a hunk from its header and shows only the hunks that are left", async () => {
  const { user, api } = await openChanges(unstaged, {
    [diffKey({ list: "unstaged", path: "notes.txt" })]: twoHunks,
  });
  const diff = await screen.findByRole("region", { name: "Diff of notes.txt" });

  await user.click(within(diff).getByRole("button", { name: /Stage hunk @@ -1,2/ }));
  const remaining = await screen.findByRole("region", { name: "Diff of notes.txt" });
  await user.click(await within(remaining).findByRole("button", { name: /Stage hunk @@ -20,2/ }));

  await waitFor(() => expect(api.stagedLines).toHaveLength(2));
  expect(api.stagedLines.map(({ direction, selection }) => [direction, selection.lines.length])).toEqual([
    ["stage", 2],
    ["stage", 2],
  ]);
});

it("stages only the lines that were ticked", async () => {
  const { user, api } = await openChanges(unstaged, {
    [diffKey({ list: "unstaged", path: "notes.txt" })]: twoHunks,
  });
  const diff = await screen.findByRole("region", { name: "Diff of notes.txt" });
  const stageSelected = within(diff).getByRole("button", { name: "Stage selected lines" });
  expect(stageSelected).toBeDisabled();

  await user.click(within(diff).getByRole("checkbox", { name: "Select added line 3" }));
  await user.click(stageSelected);

  await waitFor(() => expect(api.stagedLines).toHaveLength(1));
  expect(api.stagedLines[0]?.selection.lines).toEqual([line("added", "one and three quarters", null, 3)]);
  const remaining = await screen.findByRole("region", { name: "Diff of notes.txt" });
  await waitFor(() => expect(within(remaining).queryByText("one and three quarters")).not.toBeInTheDocument());
  expect(within(remaining).getByText("one and a half")).toBeInTheDocument();
});

it("unstages a hunk of a staged file", async () => {
  const { user, api } = await openChanges(staged, {
    [diffKey({ list: "staged", path: "notes.txt" })]: twoHunks,
  });
  const diff = await screen.findByRole("region", { name: "Diff of notes.txt" });

  await user.click(within(diff).getByRole("button", { name: /Unstage hunk @@ -20,2/ }));

  await waitFor(() => expect(api.stagedLines.map(({ direction }) => direction)).toEqual(["unstage"]));
  expect(api.stagedLines[0]?.selection.lines).toEqual([line("removed", "old", 21, null), line("added", "new", null, 22)]);
});

it("offers the same controls in side-by-side mode", async () => {
  const { user } = await openChanges(unstaged, {
    [diffKey({ list: "unstaged", path: "notes.txt" })]: twoHunks,
  });
  const diff = await screen.findByRole("region", { name: "Diff of notes.txt" });

  await user.click(within(diff).getByRole("button", { name: "Side by side" }));

  expect(within(diff).getAllByRole("button", { name: /Stage hunk/ })).toHaveLength(2);
  expect(within(diff).getByRole("checkbox", { name: "Select removed line 21" })).toBeInTheDocument();
});
