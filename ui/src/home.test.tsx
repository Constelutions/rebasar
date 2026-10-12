import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { FileChange, PullRequest, WorktreeStatus } from "./core/api";
import { type StubGitHub, createStubCoreApi } from "./core/stub";
import { renderApp, sampleTab } from "./test-support";

const worktree = sampleTab.worktreePath;

function change(path: string): FileChange {
  return { path, originalPath: null, kind: "modified", added: 1, removed: 0 };
}

const status: WorktreeStatus = {
  conflicts: [],
  staged: [change("a.txt")],
  unstaged: [change("b.txt"), change("c.txt")],
};

function pullRequest(number: number): PullRequest {
  return {
    number,
    title: `PR ${number}`,
    url: `https://github.com/acme/widgets/pull/${number}`,
    author: "octocat",
    headBranch: "x",
    baseBranch: "main",
    isDraft: false,
    checks: "none",
    review: "none",
  };
}

interface Options {
  github?: StubGitHub;
}

async function openHome({ github = {} }: Options = {}) {
  const user = userEvent.setup();
  const api = createStubCoreApi({ [worktree]: sampleTab }, { [worktree]: status }, {}, {}, github);
  api.setSyncStatus(worktree, { ahead: 2, behind: 1 });
  api.setStashes(worktree, [
    {
      info: { id: "a".repeat(40), shortId: "aaaaaaa", message: "One", branch: "main", timestamp: 1 },
      preview: { files: [], untracked: [] },
    },
  ]);
  renderApp({ api, pickFolder: async () => worktree });
  await user.click(screen.getByRole("button", { name: /open folder/i }));
  await screen.findByRole("tab");
  await user.click(screen.getByRole("button", { name: "Home" }));
  const overview = await screen.findByRole("navigation", { name: "Overview" });
  return { user, api, overview: within(overview) };
}

const githubWithPullRequests: StubGitHub = {
  remotes: { [worktree]: { owner: "acme", name: "widgets" } },
  signedInWith: "ghCli",
  pullRequests: { [worktree]: [pullRequest(1), pullRequest(2), pullRequest(3)] },
};

it("shows a row of counts for the Tab in front", async () => {
  const { overview } = await openHome({ github: githubWithPullRequests });

  await waitFor(() => expect(overview.getByRole("button", { name: /ahead/ })).toHaveTextContent("↑2 ↓1"));
  expect(overview.getByRole("button", { name: /changes/ })).toHaveTextContent("3");
  expect(overview.getByRole("button", { name: /branch/ })).toHaveTextContent("1");
  expect(overview.getByRole("button", { name: /stash/ })).toHaveTextContent("1");
  expect(overview.getByRole("button", { name: /worktree/ })).toHaveTextContent("1");
  await waitFor(() => expect(overview.getByRole("button", { name: /pull requests/ })).toHaveTextContent("3"));
});

it("has nothing but the counts: no feed, cards or charts", async () => {
  await openHome({ github: githubWithPullRequests });

  expect(screen.getByRole("main")).not.toHaveTextContent("Recent");
  expect(within(screen.getByRole("main")).queryByRole("img")).not.toBeInTheDocument();
  expect(screen.queryByRole("list", { name: /activity/i })).not.toBeInTheDocument();
});

it.each([
  [/changes/, "Changes"],
  [/ahead/, "History"],
  [/branch/, "Branches"],
  [/stash/, "Stashes"],
  [/worktree/, "Worktrees"],
  [/pull requests/, "Pull requests"],
])("links the %s count to its view", async (name, view) => {
  const { user, overview } = await openHome({ github: githubWithPullRequests });
  await waitFor(() => expect(overview.getByRole("button", { name: /pull requests/ })).toHaveTextContent("3"));

  await user.click(overview.getByRole("button", { name }));

  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(view);
});

it("hides the pull request count for a Repository that is not on GitHub", async () => {
  const { overview } = await openHome();
  await waitFor(() => expect(overview.getByRole("button", { name: /ahead/ })).toBeInTheDocument());

  expect(overview.queryByRole("button", { name: /pull request/ })).not.toBeInTheDocument();
});

it("shows a dash instead of a number for pull requests while signed out of GitHub", async () => {
  const { overview } = await openHome({
    github: { remotes: { [worktree]: { owner: "acme", name: "widgets" } }, signedInWith: null },
  });

  await waitFor(() => expect(overview.getByRole("button", { name: /pull request/ })).toHaveTextContent("–"));
});

it("updates the counts as the underlying state changes", async () => {
  const { api, overview } = await openHome({ github: githubWithPullRequests });
  await waitFor(() => expect(overview.getByRole("button", { name: /ahead/ })).toHaveTextContent("↑2 ↓1"));

  api.setSyncStatus(worktree, { ahead: 0, behind: 5 });
  api.changeWorktree(worktree, { conflicts: [], staged: [], unstaged: [change("only.txt")] });

  await waitFor(() => expect(overview.getByRole("button", { name: /ahead/ })).toHaveTextContent("↑0 ↓5"));
  await waitFor(() => expect(overview.getByRole("button", { name: /change/ })).toHaveTextContent("1"));
});

it("shows the Operation in progress banner on Home when there is one", async () => {
  const user = userEvent.setup();
  const api = createStubCoreApi({ [worktree]: sampleTab }, { [worktree]: status });
  api.setOperation(worktree, { kind: "merge", step: null, conflicts: 1, canSkip: false });
  renderApp({ api, pickFolder: async () => worktree });
  await user.click(screen.getByRole("button", { name: /open folder/i }));
  await screen.findByRole("tab");
  await user.click(screen.getByRole("button", { name: "Home" }));

  expect(await screen.findByRole("region", { name: "Operation in progress" })).toBeInTheDocument();
  expect(await screen.findByRole("navigation", { name: "Overview" })).toBeInTheDocument();
});

it("asks to open a folder when there is no Tab", async () => {
  renderApp({ api: createStubCoreApi() });

  expect(screen.getByText("Open a folder to see its overview.")).toBeInTheDocument();
});
