import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { PullRequest } from "./core/api";
import { type StubGitHub, createStubCoreApi } from "./core/stub";
import { renderApp, sampleTab } from "./test-support";

const worktree = sampleTab.worktreePath;

function pullRequest(overrides: Partial<PullRequest> & Pick<PullRequest, "number" | "title">): PullRequest {
  return {
    url: `https://github.com/acme/widgets/pull/${overrides.number}`,
    author: "octocat",
    headBranch: "other",
    baseBranch: "main",
    isDraft: false,
    checks: "none",
    review: "none",
    ...overrides,
  };
}

function github(pullRequests: PullRequest[]): StubGitHub {
  return {
    remotes: { [worktree]: { owner: "acme", name: "widgets" } },
    signedInWith: "ghCli",
    pullRequests: { [worktree]: pullRequests },
  };
}

async function openPullRequests(stub: StubGitHub) {
  const user = userEvent.setup();
  const api = createStubCoreApi({ [worktree]: sampleTab }, {}, {}, {}, stub);
  renderApp({ api, pickFolder: async () => worktree });
  await user.click(screen.getByRole("button", { name: /open folder/i }));
  await screen.findByRole("tab");
  await user.click(screen.getByRole("button", { name: "Pull requests" }));
  return { user, api };
}

it("opens a pull request in the browser from the list", async () => {
  const { user, api } = await openPullRequests(github([pullRequest({ number: 5, title: "Five" })]));

  await user.click(await screen.findByRole("button", { name: "Open #5 in the browser" }));

  await waitFor(() => expect(api.pullRequestActions).toEqual(["open:https://github.com/acme/widgets/pull/5"]));
});

it("marks a draft ready for review and the draft badge goes away", async () => {
  const { user, api } = await openPullRequests(github([pullRequest({ number: 6, title: "Six", isDraft: true })]));
  expect(await screen.findByText("Draft")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Mark #6 ready for review" }));

  await waitFor(() => expect(api.pullRequestActions).toEqual(["ready:#6"]));
  await waitFor(() => expect(screen.queryByText("Draft")).not.toBeInTheDocument());
  expect(screen.queryByRole("button", { name: "Mark #6 ready for review" })).not.toBeInTheDocument();
});

it("offers no ready button for a pull request that is not a draft", async () => {
  await openPullRequests(github([pullRequest({ number: 7, title: "Seven" })]));

  await screen.findByText("Seven");

  expect(screen.queryByRole("button", { name: /ready for review/ })).not.toBeInTheDocument();
});

it("creates a pull request for the current branch with a title, description and draft state", async () => {
  const { user, api } = await openPullRequests(github([]));

  await user.click(await screen.findByRole("button", { name: "Create pull request" }));
  const dialog = within(await screen.findByRole("dialog", { name: "Create a pull request" }));
  await user.clear(dialog.getByLabelText("Title"));
  await user.type(dialog.getByLabelText("Title"), "Add the cache");
  await user.type(dialog.getByLabelText("Description"), "It is faster.");
  await user.click(dialog.getByRole("checkbox", { name: "Open as a draft" }));
  await user.click(dialog.getByRole("button", { name: "Create pull request" }));

  await waitFor(() => expect(api.pullRequestActions).toEqual(["create:Add the cache:draft"]));
  expect(await screen.findByText("Add the cache")).toBeInTheDocument();
  expect(await screen.findByRole("button", { name: /Edit pull request #/ })).toBeInTheDocument();
});

it("cannot create a pull request without a title", async () => {
  const { user } = await openPullRequests(github([]));

  await user.click(await screen.findByRole("button", { name: "Create pull request" }));
  const dialog = within(await screen.findByRole("dialog"));
  await user.clear(dialog.getByLabelText("Title"));

  expect(dialog.getByRole("button", { name: "Create pull request" })).toBeDisabled();
});

it("updates the existing pull request of the current branch", async () => {
  const { user, api } = await openPullRequests(
    github([pullRequest({ number: 9, title: "Old title", headBranch: "main" })]),
  );

  await user.click(await screen.findByRole("button", { name: "Edit pull request #9" }));
  const dialog = within(await screen.findByRole("dialog", { name: "Edit pull request #9" }));
  await user.clear(dialog.getByLabelText("Title"));
  await user.type(dialog.getByLabelText("Title"), "New title");
  await user.click(dialog.getByRole("button", { name: "Update pull request" }));

  await waitFor(() => expect(api.pullRequestActions).toEqual(["update:#9:New title"]));
  expect(await screen.findByText("New title")).toBeInTheDocument();
});

it("opens the pull request of the current branch in the browser", async () => {
  const { user, api } = await openPullRequests(
    github([pullRequest({ number: 9, title: "Mine", headBranch: "main" })]),
  );

  await user.click(await screen.findByRole("button", { name: "Open the current branch's pull request #9 in the browser" }));

  await waitFor(() => expect(api.pullRequestActions[0]).toBe("open:https://github.com/acme/widgets/pull/9"));
});

it("shows the error when GitHub refuses", async () => {
  const { user, api } = await openPullRequests(github([]));
  const refusing = { ...api, createPullRequest: async () => { throw { kind: "githubRequestFailed", message: "Head sha can't be blank" }; } };
  void refusing;
  api.createPullRequest = refusing.createPullRequest;

  await user.click(await screen.findByRole("button", { name: "Create pull request" }));
  const dialog = within(await screen.findByRole("dialog"));
  await user.type(dialog.getByLabelText("Title"), "Add it");
  await user.click(dialog.getByRole("button", { name: "Create pull request" }));

  expect(await dialog.findByRole("alert")).toHaveTextContent("Head sha can't be blank");
});

it("offers to update the existing pull request after pushing from the commit composer", async () => {
  const user = userEvent.setup();
  const api = createStubCoreApi(
    { [worktree]: sampleTab },
    { [worktree]: { conflicts: [], staged: [{ path: "a.txt", originalPath: null, kind: "modified", added: 1, removed: 0 }], unstaged: [] } },
    {},
    {},
    github([pullRequest({ number: 12, title: "Open work", headBranch: "main" })]),
  );
  renderApp({ api, pickFolder: async () => worktree });
  await user.click(screen.getByRole("button", { name: /open folder/i }));
  await screen.findByRole("tab");
  await user.click(screen.getByRole("button", { name: "Changes" }));

  await user.type(await screen.findByLabelText("Commit message"), "feat: more");
  await user.click(screen.getByRole("button", { name: "Commit & Push" }));

  const offer = await screen.findByText(/Pull request #12 is open for this branch/);
  expect(offer).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Update pull request" }));
  const dialog = within(await screen.findByRole("dialog", { name: "Edit pull request #12" }));
  await user.clear(dialog.getByLabelText("Title"));
  await user.type(dialog.getByLabelText("Title"), "Open work, updated");
  await user.click(dialog.getByRole("button", { name: "Update pull request" }));

  await waitFor(() => expect(api.pullRequestActions).toEqual(["update:#12:Open work, updated"]));
});

it("offers nothing after a push when the branch has no pull request", async () => {
  const user = userEvent.setup();
  const api = createStubCoreApi(
    { [worktree]: sampleTab },
    { [worktree]: { conflicts: [], staged: [{ path: "a.txt", originalPath: null, kind: "modified", added: 1, removed: 0 }], unstaged: [] } },
    {},
    {},
    github([]),
  );
  renderApp({ api, pickFolder: async () => worktree });
  await user.click(screen.getByRole("button", { name: /open folder/i }));
  await screen.findByRole("tab");
  await user.click(screen.getByRole("button", { name: "Changes" }));

  await user.type(await screen.findByLabelText("Commit message"), "feat: more");
  await user.click(screen.getByRole("button", { name: "Commit & Push" }));

  await waitFor(() => expect(api.syncActions).toContain("push"));
  expect(screen.queryByText(/is open for this branch/)).not.toBeInTheDocument();
});
