import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { type BranchInfo, type Settings, defaultSettings } from "./core/api";
import { createStubCoreApi } from "./core/stub";
import { renderApp, sampleTab } from "./test-support";

const worktree = sampleTab.worktreePath;

function branch(name: string, overrides: Partial<BranchInfo> = {}): BranchInfo {
  return {
    name,
    kind: "local",
    current: false,
    upstream: null,
    ahead: 0,
    behind: 0,
    merged: false,
    shortId: "abc1234",
    ...overrides,
  };
}

const branches = [
  branch("main", { current: true, merged: true, upstream: "origin/main", ahead: 2, behind: 1 }),
  branch("topic"),
  branch("old", { merged: true }),
  branch("origin/main", { kind: "remote", merged: true }),
  branch("origin/feature", { kind: "remote" }),
];

async function openBranches(list: BranchInfo[] = branches, settings?: Settings) {
  const user = userEvent.setup();
  const api = createStubCoreApi({ [worktree]: sampleTab }, {}, {}, {}, {}, undefined, { settings });
  api.setBranchDetails(worktree, list);
  renderApp({ api, pickFolder: async () => worktree });
  await user.click(screen.getByRole("button", { name: /open folder/i }));
  await screen.findByRole("tab");
  await user.click(screen.getByRole("button", { name: "Branches" }));
  return { user, api };
}

function row(name: string) {
  return screen.findByText(name, { selector: ".branch-name" }).then((element) => element.closest("li") as HTMLElement);
}

function badges(element: HTMLElement) {
  return [...element.querySelectorAll(".branch-presence")].map((badge) => badge.textContent);
}

it("lists each branch once with its ahead, behind, upstream and merged state", async () => {
  await openBranches();

  const list = await screen.findByRole("list", { name: "Branches" });

  expect(within(list).getAllByRole("listitem")).toHaveLength(4);
  const main = await row("main");
  expect(main).toHaveTextContent("current");
  expect(main).toHaveTextContent("origin/main");
  expect(within(main).getByLabelText("2 ahead, 1 behind")).toBeInTheDocument();
  expect(await row("old")).toHaveTextContent("merged");
  expect(await row("topic")).not.toHaveTextContent("merged");
});

it("shows a branch that exists locally and on a remote as one row with both badges", async () => {
  await openBranches();

  expect(badges(await row("main"))).toEqual(["local", "origin"]);
  expect(screen.getAllByText("main", { selector: ".branch-name" })).toHaveLength(1);
  expect(badges(await row("topic"))).toEqual(["local"]);
});

it("shows a remote-only branch as its own row", async () => {
  await openBranches();

  const feature = await row("feature");

  expect(badges(feature)).toEqual(["origin"]);
  expect(screen.queryByText("origin/feature", { selector: ".branch-name" })).not.toBeInTheDocument();
});

it("gives a branch on several remotes one badge per remote", async () => {
  await openBranches([
    branch("main", { current: true }),
    branch("origin/shared", { kind: "remote" }),
    branch("backup/shared", { kind: "remote" }),
  ]);

  expect(badges(await row("shared"))).toEqual(["origin", "backup"]);
});

it("tells the remote from the branch name when the remote's own name contains a slash", async () => {
  const user = userEvent.setup();
  const api = createStubCoreApi({ [worktree]: sampleTab });
  await api.addRemote(worktree, "team/fork", "https://example.com/fork.git");
  api.setBranchDetails(worktree, [branch("main", { current: true }), branch("team/fork/wip", { kind: "remote" })]);
  renderApp({ api, pickFolder: async () => worktree });
  await user.click(screen.getByRole("button", { name: /open folder/i }));
  await screen.findByRole("tab");
  await user.click(screen.getByRole("button", { name: "Branches" }));

  expect(badges(await row("wip"))).toEqual(["team/fork"]);
});

it("filters the list to local branches, remote branches or both", async () => {
  const { user } = await openBranches();
  await row("topic");
  expect(screen.getByRole("radio", { name: "Both" })).toBeChecked();

  await user.click(screen.getByRole("radio", { name: "Local" }));
  expect(screen.getAllByRole("listitem").map((item) => item.querySelector(".branch-name")?.textContent)).toEqual([
    "main",
    "topic",
    "old",
  ]);

  await user.click(screen.getByRole("radio", { name: "Remote" }));
  expect(screen.getAllByRole("listitem").map((item) => item.querySelector(".branch-name")?.textContent)).toEqual([
    "main",
    "feature",
  ]);

  await user.click(screen.getByRole("radio", { name: "Both" }));
  expect(screen.getAllByRole("listitem")).toHaveLength(4);
});

it("opens with the filter the settings name", async () => {
  await openBranches(branches, { ...defaultSettings, branches: { filter: "remote" } });
  await row("feature");

  expect(screen.getByRole("radio", { name: "Remote" })).toBeChecked();
  expect(screen.queryByText("topic", { selector: ".branch-name" })).not.toBeInTheDocument();
});

it("filters the list by what is typed in the search box", async () => {
  const { user } = await openBranches();
  await row("topic");

  await user.type(screen.getByRole("searchbox", { name: "Search branches" }), "OP");

  expect(screen.getAllByRole("listitem")).toHaveLength(1);
  expect(await row("topic")).toBeInTheDocument();
});

it("says so when no branch matches the search", async () => {
  const { user } = await openBranches();
  await row("topic");

  await user.type(screen.getByRole("searchbox", { name: "Search branches" }), "zzz");

  expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  expect(screen.getByText("No branches match.")).toBeInTheDocument();
});

it("asks to open a folder when there is no Tab", async () => {
  const user = userEvent.setup();
  renderApp({ api: createStubCoreApi() });

  await user.click(screen.getByRole("button", { name: "Branches" }));

  expect(screen.getByText("Open a folder to see its branches.")).toBeInTheDocument();
});

it("creates a branch and switches to it with Create & Switch", async () => {
  const { user, api } = await openBranches();
  await row("main");

  await user.type(screen.getByRole("textbox", { name: "New branch" }), "feature/login");
  await user.click(screen.getByRole("button", { name: "Create & Switch" }));

  await waitFor(() => expect(api.branchActions).toEqual(["create:feature/login:switch"]));
  expect(await row("feature/login")).toHaveTextContent("current");
});

it("creates a branch without switching with Create", async () => {
  const { user, api } = await openBranches();
  await row("main");

  await user.type(screen.getByRole("textbox", { name: "New branch" }), "spare");
  await user.click(screen.getByRole("button", { name: "Create" }));

  await waitFor(() => expect(api.branchActions).toEqual(["create:spare"]));
  expect(await row("main")).toHaveTextContent("current");
});

it("has no Switch to it checkbox any more", async () => {
  await openBranches();
  await row("main");

  expect(screen.queryByRole("checkbox", { name: "Switch to it" })).not.toBeInTheDocument();
});

it("checks out a local branch and a remote one", async () => {
  const { user, api } = await openBranches();
  await row("topic");

  await user.click(screen.getByRole("button", { name: "Check out topic" }));
  await user.click(await screen.findByRole("button", { name: "Check out feature" }));

  await waitFor(() => expect(api.branchActions).toEqual(["checkout:topic", "checkout:origin/feature"]));
  expect(await row("feature")).toHaveTextContent("current");
});

it("renames a branch", async () => {
  const { user, api } = await openBranches();
  await row("topic");

  await user.click(screen.getByRole("button", { name: "Rename topic" }));
  const dialog = await screen.findByRole("dialog", { name: "Rename topic" });
  await user.clear(within(dialog).getByLabelText("New name"));
  await user.type(within(dialog).getByLabelText("New name"), "renamed");
  await user.click(within(dialog).getByRole("button", { name: "Rename" }));

  await waitFor(() => expect(api.branchActions).toEqual(["rename:topic:renamed"]));
  expect(await row("renamed")).toBeInTheDocument();
});

it("sets and clears the upstream of a branch", async () => {
  const { user, api } = await openBranches();
  await row("topic");

  await user.click(screen.getByRole("button", { name: "Set upstream of topic" }));
  let dialog = await screen.findByRole("dialog");
  await user.type(within(dialog).getByLabelText(/Upstream branch/), "origin/topic");
  await user.click(within(dialog).getByRole("button", { name: "Set upstream" }));
  await waitFor(() => expect(api.branchActions).toEqual(["upstream:topic:origin/topic"]));

  await user.click(await screen.findByRole("button", { name: "Set upstream of topic" }));
  dialog = await screen.findByRole("dialog");
  await user.clear(within(dialog).getByLabelText(/Upstream branch/));
  await user.click(within(dialog).getByRole("button", { name: "Set upstream" }));
  await waitFor(() => expect(api.branchActions.at(-1)).toBe("upstream:topic:"));
});

it("deletes a merged branch without asking", async () => {
  const { user, api } = await openBranches();
  await row("old");

  await user.click(screen.getByRole("button", { name: "Delete old" }));

  await waitFor(() => expect(api.branchActions).toEqual(["delete:old"]));
  await waitFor(() => expect(screen.queryByText("old", { selector: ".branch-name" })).not.toBeInTheDocument());
});

it("asks before deleting an unmerged branch and deletes it only once confirmed", async () => {
  const { user, api } = await openBranches();
  await row("topic");

  await user.click(screen.getByRole("button", { name: "Delete topic" }));
  const dialog = await screen.findByRole("alertdialog", { name: "Delete branch" });

  expect(dialog).toHaveTextContent("2 commits will no longer be reachable");
  expect(api.branchActions).toEqual([]);
  await user.click(within(dialog).getByRole("button", { name: "Delete" }));
  await waitFor(() => expect(api.branchActions).toEqual(["delete:topic"]));
});

it("keeps an unmerged branch when the confirmation is cancelled", async () => {
  const { user, api } = await openBranches();
  await row("topic");

  await user.click(screen.getByRole("button", { name: "Delete topic" }));
  await user.click(await screen.findByRole("button", { name: "Cancel" }));

  expect(api.branchActions).toEqual([]);
  expect(await row("topic")).toBeInTheDocument();
});

it("cannot delete or merge the current branch", async () => {
  await openBranches();
  const main = await row("main");

  expect(within(main).queryByRole("button", { name: /Delete/ })).not.toBeInTheDocument();
  expect(within(main).queryByRole("button", { name: /Merge/ })).not.toBeInTheDocument();
  expect(within(main).queryByRole("button", { name: /Check out/ })).not.toBeInTheDocument();
});

it("merges a branch into the current one with each strategy", async () => {
  const { user, api } = await openBranches();
  await row("topic");

  await user.click(screen.getByRole("button", { name: "Merge topic" }));
  await user.click(await screen.findByRole("button", { name: "Merge topic with a merge commit" }));
  await user.click(await screen.findByRole("button", { name: "Squash merge topic" }));

  await waitFor(() =>
    expect(api.branchActions).toEqual(["merge:topic:default", "merge:topic:noFastForward", "merge:topic:squash"]),
  );
});

it("rebases the current branch onto another", async () => {
  const { user, api } = await openBranches();
  await row("topic");

  await user.click(screen.getByRole("button", { name: "Rebase onto topic" }));

  await waitFor(() => expect(api.branchActions).toEqual(["rebase:topic"]));
});

it("acts on the local branch of a merged row and on the remote ref of a remote-only row", async () => {
  const { user, api } = await openBranches([
    branch("main", { current: true }),
    branch("topic"),
    branch("origin/topic", { kind: "remote" }),
    branch("origin/feature", { kind: "remote" }),
  ]);
  await row("topic");

  await user.click(screen.getByRole("button", { name: "Merge topic" }));
  await user.click(await screen.findByRole("button", { name: "Rebase onto topic" }));
  await user.click(await screen.findByRole("button", { name: "Merge feature" }));
  await user.click(await screen.findByRole("button", { name: "Rebase onto feature" }));

  await waitFor(() =>
    expect(api.branchActions).toEqual([
      "merge:topic:default",
      "rebase:topic",
      "merge:origin/feature:default",
      "rebase:origin/feature",
    ]),
  );
});

it("offers rename, upstream and delete only for branches that exist locally", async () => {
  await openBranches();

  expect(within(await row("topic")).getByRole("button", { name: "Rename topic" })).toBeInTheDocument();
  const feature = await row("feature");
  expect(within(feature).queryByRole("button", { name: /Rename/ })).not.toBeInTheDocument();
  expect(within(feature).queryByRole("button", { name: /Upstream/ })).not.toBeInTheDocument();
  expect(within(feature).queryByRole("button", { name: /Delete/ })).not.toBeInTheDocument();
});

it("says so when a merge fails and points to the output panel", async () => {
  const { user, api } = await openBranches();
  api.failNextMutation({ exitCode: 1, output: ["CONFLICT (content): Merge conflict in a.txt"] });
  await row("topic");

  await user.click(screen.getByRole("button", { name: "Merge topic" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("Merge topic failed");
});

it("offers to check out a branch from the command palette", async () => {
  const { user, api } = await openBranches();
  await row("topic");
  api.setBranches(worktree, [
    { kind: "localBranch", name: "main" },
    { kind: "localBranch", name: "topic" },
  ]);

  await user.keyboard("{Control>}p{/Control}");
  await user.type(screen.getByRole("combobox"), "check out branch topic");
  await user.keyboard("{Enter}");

  await waitFor(() => expect(api.branchActions).toContain("checkout:topic"));
});
