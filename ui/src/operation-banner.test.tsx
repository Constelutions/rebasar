import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { FileChange, OperationInProgress, WorktreeStatus } from "./core/api";
import { createStubCoreApi } from "./core/stub";
import { renderApp, sampleTab } from "./test-support";

const worktree = sampleTab.worktreePath;

const conflicted: FileChange = {
  path: "a.txt",
  originalPath: null,
  kind: "conflicted",
  added: null,
  removed: null,
};

const rebase: OperationInProgress = {
  kind: "rebase",
  step: { current: 1, total: 3 },
  conflicts: 1,
  canSkip: true,
};

async function openTab(operation: OperationInProgress | null, status?: Partial<WorktreeStatus>) {
  const user = userEvent.setup();
  const api = createStubCoreApi(
    { [worktree]: sampleTab },
    { [worktree]: { conflicts: [], staged: [], unstaged: [], ...status } },
  );
  if (operation) api.setOperation(worktree, operation);
  renderApp({ api, pickFolder: async () => worktree });
  await user.click(screen.getByRole("button", { name: /open folder/i }));
  await screen.findByRole("tab");
  return { user, api };
}

function banner() {
  return screen.findByRole("region", { name: "Operation in progress" });
}

it("shows nothing when no operation is in progress", async () => {
  await openTab(null);

  expect(screen.queryByRole("region", { name: "Operation in progress" })).not.toBeInTheDocument();
});

it("names the operation, its progress and its conflicts", async () => {
  await openTab(rebase, { conflicts: [conflicted] });

  expect(await banner()).toHaveTextContent("Rebase in progress · commit 1 of 3 · 1 conflict");
});

it.each([
  ["merge", "Merge"],
  ["cherryPick", "Cherry-pick"],
  ["revert", "Revert"],
] as const)("names a paused %s", async (kind, name) => {
  await openTab({ kind, step: null, conflicts: 2, canSkip: kind !== "merge" });

  expect(await banner()).toHaveTextContent(`${name} in progress · 2 conflicts`);
});

it("stays visible on every view of the Tab", async () => {
  const { user } = await openTab(rebase);
  await banner();

  for (const view of ["History", "Changes", "Repositories", "Settings"]) {
    await user.click(screen.getByRole("button", { name: view }));
    expect(screen.getByRole("region", { name: "Operation in progress" })).toBeInTheDocument();
  }
});

it("cannot skip a merge", async () => {
  await openTab({ kind: "merge", step: null, conflicts: 0, canSkip: false });
  const region = within(await banner());

  expect(region.queryByRole("button", { name: "Skip" })).not.toBeInTheDocument();
});

it("holds Continue back while conflicts are left and then runs it through the core", async () => {
  const { user, api } = await openTab({ ...rebase, conflicts: 1 });
  expect(within(await banner()).getByRole("button", { name: "Continue" })).toBeDisabled();

  api.setOperation(worktree, { ...rebase, conflicts: 0 });
  const continueButton = await within(await banner()).findByText(/no conflicts/);
  expect(continueButton).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Continue" }));

  expect(api.operationActions).toEqual(["continue"]);
});

it("disappears once the operation is finished", async () => {
  const { user, api } = await openTab({ ...rebase, conflicts: 0 });
  await banner();

  await user.click(screen.getByRole("button", { name: "Continue" }));

  await waitFor(() =>
    expect(screen.queryByRole("region", { name: "Operation in progress" })).not.toBeInTheDocument(),
  );
  expect(api.operationActions).toEqual(["continue"]);
});

it("skips the commit the rebase is stopped on", async () => {
  const { user, api } = await openTab(rebase);
  await banner();

  await user.click(screen.getByRole("button", { name: "Skip" }));

  expect(api.operationActions).toEqual(["skip"]);
});

it("asks for confirmation naming the files before aborting", async () => {
  const { user, api } = await openTab(rebase, { conflicts: [conflicted] });
  await banner();

  await user.click(screen.getByRole("button", { name: "Abort" }));
  const dialog = await screen.findByRole("alertdialog", { name: "Abort the operation" });

  expect(dialog).toHaveTextContent("a.txt");
  expect(api.operationActions).toEqual([]);
  await user.click(within(dialog).getByRole("button", { name: "Abort" }));
  expect(api.operationActions).toEqual(["abort"]);
  await waitFor(() =>
    expect(screen.queryByRole("region", { name: "Operation in progress" })).not.toBeInTheDocument(),
  );
});

it("leaves the operation alone when the confirmation is cancelled", async () => {
  const { user, api } = await openTab(rebase, { conflicts: [conflicted] });
  await banner();

  await user.click(screen.getByRole("button", { name: "Abort" }));
  await user.click(await screen.findByRole("button", { name: "Cancel" }));

  expect(api.operationActions).toEqual([]);
  expect(screen.getByRole("region", { name: "Operation in progress" })).toBeInTheDocument();
});

it("aborts straight away when there is nothing to lose", async () => {
  const { user, api } = await openTab({ kind: "merge", step: null, conflicts: 0, canSkip: false });
  await banner();

  await user.click(screen.getByRole("button", { name: "Abort" }));

  await waitFor(() => expect(api.operationActions).toEqual(["abort"]));
});

it("offers Continue and Skip in the command palette only while they apply", async () => {
  const { user, api } = await openTab({ ...rebase, conflicts: 0 });
  await banner();

  await user.keyboard("{Control>}p{/Control}");
  await user.type(screen.getByRole("combobox"), "skip the current");
  await user.keyboard("{Enter}");

  await waitFor(() => expect(api.operationActions).toEqual(["skip"]));
});
