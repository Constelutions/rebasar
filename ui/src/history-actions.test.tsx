import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { FileChange } from "./core/api";
import { createStubCoreApi } from "./core/stub";
import { commitRow, localTime, renderApp, sampleTab } from "./test-support";

const worktree = sampleTab.worktreePath;
const latestId = "a".repeat(40);
const olderId = "b".repeat(40);

const edited: FileChange = {
  path: "src/edited.ts",
  originalPath: null,
  kind: "modified",
  added: 3,
  removed: 1,
};

async function openHistory() {
  const user = userEvent.setup();
  const api = createStubCoreApi(
    { [worktree]: sampleTab },
    { [worktree]: { conflicts: [], staged: [], unstaged: [edited] } },
    {
      [worktree]: [
        commitRow({ id: latestId, subject: "Latest work", refs: [{ kind: "head", name: "HEAD" }] }),
        commitRow({ id: olderId, subject: "Older work", timestamp: localTime(2026, 1, 4, 12) }),
      ],
    },
  );
  renderApp({ api, pickFolder: async () => worktree });
  await user.click(screen.getByRole("button", { name: /open folder/i }));
  await screen.findByRole("tab");
  await user.click(screen.getByRole("button", { name: "History" }));
  await screen.findByRole("list", { name: "Commit history" });
  return { user, api };
}

async function choose(user: ReturnType<typeof userEvent.setup>, subject: string, item: string) {
  fireEvent.contextMenu(screen.getByText(subject), { clientX: 10, clientY: 10 });
  await user.click(await screen.findByRole("menuitem", { name: item }));
}

it("cherry-picks a commit without asking", async () => {
  const { user, api } = await openHistory();

  await choose(user, "Older work", "Cherry-pick");

  await waitFor(() => expect(api.commitActions).toEqual([{ kind: "cherryPick", commit: olderId }]));
  expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
});

it("reverts a commit without asking", async () => {
  const { user, api } = await openHistory();

  await choose(user, "Older work", "Revert");

  await waitFor(() => expect(api.commitActions).toEqual([{ kind: "revert", commit: olderId }]));
});

it("points to the banner when a cherry-pick stops", async () => {
  const { user, api } = await openHistory();
  api.failNextMutation({ exitCode: 1, output: ["CONFLICT (content): Merge conflict in a.txt"] });

  await choose(user, "Older work", "Cherry-pick");

  expect(await screen.findByRole("alert")).toHaveTextContent("Cherry-pick bbbbbbb failed");
  expect(screen.getByRole("alert")).toHaveTextContent("banner");
});

it("resets soft or mixed straight away when it drops nothing", async () => {
  const { user, api } = await openHistory();

  await choose(user, "Latest work", "Reset soft to here");
  await choose(user, "Latest work", "Reset mixed to here");

  await waitFor(() =>
    expect(api.commitActions).toEqual([
      { kind: "reset", commit: latestId, mode: "soft" },
      { kind: "reset", commit: latestId, mode: "mixed" },
    ]),
  );
});

it("names the uncommitted files a hard reset would lose before running it", async () => {
  const { user, api } = await openHistory();

  await choose(user, "Latest work", "Reset hard to here");
  const dialog = await screen.findByRole("alertdialog", { name: "Reset" });

  expect(dialog).toHaveTextContent("src/edited.ts");
  expect(dialog).toHaveTextContent("reflog");
  expect(api.commitActions).toEqual([]);
  await user.click(within(dialog).getByRole("button", { name: "Reset" }));
  await waitFor(() =>
    expect(api.commitActions).toEqual([{ kind: "reset", commit: latestId, mode: "hard" }]),
  );
});

it("names the commits a reset would drop, whatever its mode", async () => {
  const { user, api } = await openHistory();
  api.setCommitsDroppedByReset(olderId, 3);

  await choose(user, "Older work", "Reset soft to here");
  const dialog = await screen.findByRole("alertdialog", { name: "Reset" });

  expect(dialog).toHaveTextContent("3 commits will no longer be reachable from any branch");
  expect(dialog).toHaveTextContent("3 of them exist on no remote");
  expect(dialog).not.toHaveTextContent("src/edited.ts");
});

it("does nothing when the reset confirmation is cancelled", async () => {
  const { user, api } = await openHistory();

  await choose(user, "Latest work", "Reset hard to here");
  await user.click(await screen.findByRole("button", { name: "Cancel" }));

  expect(api.commitActions).toEqual([]);
});

it("says so when a reset fails", async () => {
  const { user, api } = await openHistory();
  api.setCommitsDroppedByReset(latestId, 0);
  api.failNextMutation({ exitCode: 128, output: ["fatal: unable to reset"] });

  await choose(user, "Latest work", "Reset mixed to here");

  expect(await screen.findByRole("alert")).toHaveTextContent("Reset to aaaaaaa failed");
});
