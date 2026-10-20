import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { BranchInfo, WorktreeDetail } from "./core/api";
import { createStubCoreApi } from "./core/stub";
import { renderApp, sampleTab } from "./test-support";

const worktree = sampleTab.worktreePath;

const main: WorktreeDetail = {
  path: worktree,
  main: true,
  head: { kind: "branch", name: "main" },
  dirty: false,
  current: true,
};
const linked: WorktreeDetail = {
  path: "C:\\work\\hotfix",
  main: false,
  head: { kind: "branch", name: "hotfix" },
  dirty: false,
  current: false,
};
const dirty: WorktreeDetail = { ...linked, path: "C:\\work\\wip", head: { kind: "branch", name: "wip" }, dirty: true };

function branch(name: string): BranchInfo {
  return { name, kind: "local", current: false, upstream: null, ahead: 0, behind: 0, merged: false, shortId: "abc1234" };
}

async function openWorktrees(list: WorktreeDetail[] = [main, linked], pick: string | null = null) {
  const user = userEvent.setup();
  const api = createStubCoreApi({ [worktree]: sampleTab, [linked.path]: { ...sampleTab, worktreePath: linked.path } });
  api.setWorktreeDetails(worktree, list);
  api.setBranchDetails(worktree, [branch("main"), branch("topic")]);
  let picks = 0;
  renderApp({ api, pickFolder: async () => (picks++ === 0 ? worktree : (pick ?? worktree)) });
  await user.click(screen.getByRole("button", { name: /open folder/i }));
  await screen.findByRole("tab");
  await user.click(screen.getByRole("button", { name: "Worktrees" }));
  return { user, api };
}

it("lists the worktrees with path, branch and clean or dirty state", async () => {
  await openWorktrees([main, linked, dirty]);

  const rows = within(await screen.findByRole("list", { name: "Worktrees" })).getAllByRole("listitem");

  expect(rows).toHaveLength(3);
  expect(rows[1]).toHaveTextContent("hotfix");
  expect(rows[1]).toHaveTextContent("C:\\work\\hotfix");
  expect(rows[1]).toHaveTextContent("clean");
  expect(rows[2]).toHaveTextContent("dirty");
  expect(rows[0]).toHaveTextContent("main");
});

it("asks to open a folder when there is no Tab", async () => {
  const user = userEvent.setup();
  renderApp({ api: createStubCoreApi() });

  await user.click(screen.getByRole("button", { name: "Worktrees" }));

  expect(screen.getByText("Open a folder to see its worktrees.")).toBeInTheDocument();
});

it("opens any worktree as a Tab", async () => {
  const { user } = await openWorktrees();

  await user.click(await screen.findByRole("button", { name: "Open C:\\work\\hotfix as a Tab" }));

  await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(2));
});

it("creates a worktree from a branch", async () => {
  const { user, api } = await openWorktrees();
  await screen.findByRole("list", { name: "Worktrees" });

  await user.type(screen.getByLabelText("Folder"), "C:\\work\\topic-tree");
  await user.selectOptions(screen.getByLabelText("Start from"), "Branch topic");
  await user.click(screen.getByRole("button", { name: "Add worktree" }));

  await waitFor(() => expect(api.worktreeActions).toEqual(["create:C:\\work\\topic-tree:branch:topic"]));
  expect(await screen.findByText("C:\\work\\topic-tree")).toBeInTheDocument();
});

it("creates a worktree with a new branch from a commit", async () => {
  const { user, api } = await openWorktrees();
  await screen.findByRole("list", { name: "Worktrees" });

  await user.type(screen.getByLabelText("Folder"), "C:\\work\\fix");
  await user.type(screen.getByLabelText("Commit"), "abc1234");
  await user.type(screen.getByLabelText("New branch (optional)"), "fix-branch");
  await user.click(screen.getByRole("button", { name: "Add worktree" }));

  await waitFor(() =>
    expect(api.worktreeActions).toEqual(["create:C:\\work\\fix:commit:abc1234:new:fix-branch"]),
  );
});

it("fills the folder from the folder picker", async () => {
  const { user } = await openWorktrees([main], "C:\\work");
  await screen.findByRole("list", { name: "Worktrees" });

  await user.click(screen.getByRole("button", { name: "Choose folder…" }));

  expect(screen.getByLabelText("Folder")).toHaveValue("C:\\work/worktree");
});

it("cannot add a worktree without a folder", async () => {
  await openWorktrees();

  expect(await screen.findByRole("button", { name: "Add worktree" })).toBeDisabled();
});

it("removes a clean worktree straight away and it disappears from the list", async () => {
  const { user, api } = await openWorktrees();

  await user.click(await screen.findByRole("button", { name: "Remove C:\\work\\hotfix" }));

  await waitFor(() => expect(api.worktreeActions).toEqual(["remove:C:\\work\\hotfix:force"]));
  await waitFor(() => expect(screen.queryByText("C:\\work\\hotfix")).not.toBeInTheDocument());
});

it("asks before removing a dirty worktree and removes it only once confirmed", async () => {
  const { user, api } = await openWorktrees([main, dirty]);

  await user.click(await screen.findByRole("button", { name: "Remove C:\\work\\wip" }));
  const dialog = await screen.findByRole("alertdialog", { name: "Remove worktree" });

  expect(dialog).toHaveTextContent("unsaved.ts");
  expect(api.worktreeActions).toEqual([]);
  await user.click(within(dialog).getByRole("button", { name: "Remove" }));
  await waitFor(() => expect(api.worktreeActions).toEqual(["remove:C:\\work\\wip:force"]));
});

it("keeps the dirty worktree when the confirmation is cancelled", async () => {
  const { user, api } = await openWorktrees([main, dirty]);

  await user.click(await screen.findByRole("button", { name: "Remove C:\\work\\wip" }));
  await user.click(await screen.findByRole("button", { name: "Cancel" }));

  expect(api.worktreeActions).toEqual([]);
});

it("cannot remove the main worktree", async () => {
  await openWorktrees();
  const rows = within(await screen.findByRole("list", { name: "Worktrees" })).getAllByRole("listitem");

  expect(within(rows[0] as HTMLElement).queryByRole("button", { name: /Remove/ })).not.toBeInTheDocument();
});

it("prunes worktrees whose folder is gone", async () => {
  const { user, api } = await openWorktrees();

  await user.click(await screen.findByRole("button", { name: "Prune" }));

  await waitFor(() => expect(api.worktreeActions).toEqual(["prune"]));
});

it("shows created worktrees in the Repositories view", async () => {
  const { user } = await openWorktrees();
  await screen.findByRole("list", { name: "Worktrees" });
  await user.type(screen.getByLabelText("Folder"), "C:\\work\\topic-tree");
  await user.selectOptions(screen.getByLabelText("Start from"), "Branch topic");
  await user.click(screen.getByRole("button", { name: "Add worktree" }));
  await screen.findByText("C:\\work\\topic-tree");

  await user.click(screen.getByRole("button", { name: "Repositories" }));

  expect(await screen.findByRole("main")).toBeInTheDocument();
});
