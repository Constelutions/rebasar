import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { CommitDetail, FileChange, FileDiff } from "./core/api";
import { commitKey, createStubCoreApi, worktreeDiffKey } from "./core/stub";
import { commitRow, localTime, renderApp, sampleTab } from "./test-support";

const worktree = sampleTab.worktreePath;
const latestId = "a".repeat(40);
const olderId = "b".repeat(40);

function change(path: string): FileChange {
  return { path, originalPath: null, kind: "modified", added: 2, removed: 1 };
}

function detail(id: string, message: string): CommitDetail {
  return {
    id,
    shortId: id.slice(0, 7),
    authorName: "Ada Lovelace",
    authorEmail: "ada@example.com",
    authorTimestamp: localTime(2026, 1, 5, 12),
    message,
    parents: [],
    files: [],
  };
}

const comparisonDiff: FileDiff = {
  path: "src/drift.ts",
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
        lines: [{ kind: "added", text: "edited since", oldNumber: null, newNumber: 1 }],
      },
    ],
  },
};

async function openHistory() {
  const user = userEvent.setup();
  const api = createStubCoreApi(
    { [worktree]: sampleTab },
    {},
    {
      [worktree]: [
        commitRow({
          id: latestId,
          subject: "Latest work",
          refs: [{ kind: "head", name: "HEAD" }],
        }),
        commitRow({ id: olderId, subject: "Older work", timestamp: localTime(2026, 1, 4, 12) }),
      ],
    },
    {},
    {},
    undefined,
    {},
    {
      commitDetails: {
        [commitKey(latestId, 0)]: detail(latestId, "Latest work\n\nWith a body."),
        [commitKey(olderId, 0)]: detail(olderId, "Older work"),
      },
      comparisons: { [olderId]: [change("src/drift.ts")] },
      comparisonDiffs: { [worktreeDiffKey({ commit: olderId, path: "src/drift.ts" })]: comparisonDiff },
    },
  );
  renderApp({ api, pickFolder: async () => worktree });
  await user.click(screen.getByRole("button", { name: /open folder/i }));
  await screen.findByRole("tab");
  await user.click(screen.getByRole("button", { name: "History" }));
  await screen.findByRole("list", { name: "Commit history" });
  return { user, api };
}

async function openMenuOn(subject: string) {
  fireEvent.contextMenu(screen.getByText(subject), { clientX: 120, clientY: 80 });
  return screen.findByRole("menu", { name: "Commit actions" });
}

function menuItem(name: string) {
  return screen.getByRole("menuitem", { name });
}

it("offers the safe commit actions from the context menu", async () => {
  await openHistory();

  const menu = await openMenuOn("Latest work");

  expect(within(menu).getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
    "Checkout (detached)",
    "Create branch here…",
    "Create tag here…",
    "Copy hash",
    "Reword…",
    "Compare with working tree",
  ]);
});

it("opens from the keyboard on the focused commit", async () => {
  const { user } = await openHistory();
  const row = screen.getByText("Latest work").closest("[role=listitem]") as HTMLElement;

  row.focus();
  await user.keyboard("{Shift>}{F10}{/Shift}");

  expect(await screen.findByRole("menu", { name: "Commit actions" })).toBeInTheDocument();
});

it("closes on Escape and when something else is clicked", async () => {
  const { user } = await openHistory();
  await openMenuOn("Latest work");

  await user.keyboard("{Escape}");
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();

  await openMenuOn("Latest work");
  await user.click(document.body);
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
});

it("checks out the commit detached", async () => {
  const { user, api } = await openHistory();
  await openMenuOn("Older work");

  await user.click(menuItem("Checkout (detached)"));

  expect(api.commitActions).toEqual([{ kind: "checkout", commit: olderId }]);
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  const output = screen.getByRole("region", { name: "Output" });
  expect(await within(output).findByRole("status")).toHaveTextContent("Check out bbbbbbb: succeeded");
});

it("reports a checkout that Git refused", async () => {
  const { user, api } = await openHistory();
  api.failNextMutation({ exitCode: 1, output: ["error: Your local changes would be overwritten"] });
  await openMenuOn("Older work");

  await user.click(menuItem("Checkout (detached)"));

  expect(await screen.findByRole("alert")).toHaveTextContent("Check out bbbbbbb failed");
});

it("creates a branch at the commit with the name the user types", async () => {
  const { user, api } = await openHistory();
  await openMenuOn("Older work");

  await user.click(menuItem("Create branch here…"));
  const dialog = await screen.findByRole("dialog", { name: "Create branch at bbbbbbb" });
  await user.type(within(dialog).getByRole("textbox", { name: "Branch name" }), "topic/parser");
  await user.click(within(dialog).getByRole("button", { name: "Create branch" }));

  expect(api.commitActions).toEqual([
    { kind: "createBranch", name: "topic/parser", commit: olderId },
  ]);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("cannot create a branch without a name, and can be cancelled", async () => {
  const { user, api } = await openHistory();
  await openMenuOn("Older work");
  await user.click(menuItem("Create branch here…"));
  const dialog = await screen.findByRole("dialog");

  expect(within(dialog).getByRole("button", { name: "Create branch" })).toBeDisabled();
  await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(api.commitActions).toEqual([]);
});

it("keeps the dialog open and says so when Git rejects the name", async () => {
  const { user, api } = await openHistory();
  api.failNextMutation({ exitCode: 128, output: ["fatal: invalid branch name"] });
  await openMenuOn("Older work");
  await user.click(menuItem("Create branch here…"));
  const dialog = await screen.findByRole("dialog");

  await user.type(within(dialog).getByRole("textbox", { name: "Branch name" }), "bad name");
  await user.click(within(dialog).getByRole("button", { name: "Create branch" }));

  expect(await within(dialog).findByRole("alert")).toHaveTextContent("Git rejected");
  expect(screen.getByRole("dialog")).toBeInTheDocument();
});

it("creates a tag at the commit", async () => {
  const { user, api } = await openHistory();
  await openMenuOn("Latest work");

  await user.click(menuItem("Create tag here…"));
  const dialog = await screen.findByRole("dialog", { name: "Create tag at aaaaaaa" });
  await user.type(within(dialog).getByRole("textbox", { name: "Tag name" }), "v1.0");
  await user.click(within(dialog).getByRole("button", { name: "Create tag" }));

  expect(api.commitActions).toEqual([{ kind: "createTag", name: "v1.0", commit: latestId }]);
});

it("copies the full hash", async () => {
  const { user } = await openHistory();
  await openMenuOn("Older work");

  await user.click(menuItem("Copy hash"));

  expect(await navigator.clipboard.readText()).toBe(olderId);
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
});

it("rewords the latest commit from its current message", async () => {
  const { user, api } = await openHistory();
  await openMenuOn("Latest work");

  await user.click(menuItem("Reword…"));
  const dialog = await screen.findByRole("dialog", { name: "Reword aaaaaaa" });
  const message = within(dialog).getByRole("textbox", { name: "Commit message" });
  await within(dialog).findByDisplayValue(/With a body\./);
  expect(message).toHaveValue("Latest work\n\nWith a body.");

  await user.clear(message);
  await user.type(message, "Better words");
  await user.click(within(dialog).getByRole("button", { name: "Reword" }));

  expect(api.commitActions).toEqual([
    { kind: "reword", commit: latestId, message: "Better words" },
  ]);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("sends the user to the interactive rebase editor to reword an older commit", async () => {
  const { user, api } = await openHistory();
  await openMenuOn("Older work");

  await user.click(menuItem("Reword…"));

  const dialog = await screen.findByRole("dialog", { name: "Reword bbbbbbb" });
  expect(dialog).toHaveTextContent("interactive rebase editor");
  expect(within(dialog).queryByRole("textbox")).not.toBeInTheDocument();
  await user.click(within(dialog).getByRole("button", { name: "Close" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(api.commitActions).toEqual([]);
});

it("compares the commit with the working tree in the diff viewer", async () => {
  const { user } = await openHistory();
  await openMenuOn("Older work");

  await user.click(menuItem("Compare with working tree"));

  const pane = await screen.findByRole("region", { name: "Commit detail" });
  const files = await within(pane).findByRole("list", { name: "Changed files" });
  expect(files).toHaveTextContent("drift.ts");
  expect(await within(pane).findByRole("region", { name: "Diff of src/drift.ts" })).toHaveTextContent(
    "edited since",
  );
  expect(within(pane).getByRole("button", { name: "Compare with working tree" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

it("goes back to the commit's own changes when the comparison is switched off", async () => {
  const { user } = await openHistory();
  await openMenuOn("Older work");
  await user.click(menuItem("Compare with working tree"));
  const pane = await screen.findByRole("region", { name: "Commit detail" });

  await user.click(await within(pane).findByRole("button", { name: "Compare with working tree" }));

  expect(await within(pane).findByText("No files changed.")).toBeInTheDocument();
});

it("says so when the working tree matches the commit", async () => {
  const { user } = await openHistory();
  await openMenuOn("Latest work");

  await user.click(menuItem("Compare with working tree"));

  expect(await screen.findByText("The working tree matches this commit.")).toBeInTheDocument();
});
