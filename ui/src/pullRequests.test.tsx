import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { PullRequest } from "./core/api";
import { type StubGitHub, createStubCoreApi } from "./core/stub";
import { renderApp, sampleTab } from "./test-support";

const worktree = sampleTab.worktreePath;

function pullRequest(overrides: Partial<PullRequest> & Pick<PullRequest, "number" | "title">) {
  return {
    url: `https://github.com/acme/widgets/pull/${overrides.number}`,
    author: "octocat",
    headBranch: "feature",
    baseBranch: "main",
    isDraft: false,
    checks: "none",
    review: "none",
    ...overrides,
  } satisfies PullRequest;
}

const github: StubGitHub = {
  remotes: { [worktree]: { owner: "acme", name: "widgets" } },
  signedInWith: "ghCli",
  validTokens: ["good-token"],
  pullRequests: {
    [worktree]: [
      pullRequest({ number: 42, title: "Add the widget cache", checks: "success", review: "approved" }),
      pullRequest({ number: 41, title: "Rework the parser", isDraft: true, checks: "pending", author: "hubot" }),
      pullRequest({ number: 40, title: "Fix the build", checks: "failure", review: "changesRequested" }),
      pullRequest({ number: 39, title: "Write the docs", review: "reviewRequired" }),
    ],
  },
};

async function openPullRequests(stubGitHub: StubGitHub = github) {
  const user = userEvent.setup();
  const api = createStubCoreApi({ [worktree]: sampleTab }, {}, {}, {}, stubGitHub);
  renderApp({ api, pickFolder: async () => worktree });
  await user.click(screen.getByRole("button", { name: /open folder/i }));
  await screen.findByRole("tab");
  await user.click(screen.getByRole("button", { name: "Pull requests" }));
  return { user, api };
}

async function pullRequestRow(title: string) {
  const row = (await screen.findByText(title)).closest("li");
  if (!row) throw new Error(`no row for ${title}`);
  return within(row);
}

it("lists the pull requests of the Repository with their number, title and author", async () => {
  await openPullRequests();

  const row = await pullRequestRow("Add the widget cache");
  expect(row.getByText("#42")).toBeInTheDocument();
  expect(row.getByText("octocat")).toBeInTheDocument();
  expect((await pullRequestRow("Rework the parser")).getByText("hubot")).toBeInTheDocument();
});

it("marks draft pull requests and only those", async () => {
  await openPullRequests();

  expect((await pullRequestRow("Rework the parser")).getByText("Draft")).toBeInTheDocument();
  expect((await pullRequestRow("Fix the build")).queryByText("Draft")).not.toBeInTheDocument();
});

it.each([
  ["Add the widget cache", "Checks passing"],
  ["Rework the parser", "Checks running"],
  ["Fix the build", "Checks failing"],
  ["Write the docs", "No checks"],
])("shows the CI status of %s as %s", async (title, label) => {
  await openPullRequests();

  expect((await pullRequestRow(title)).getByText(label)).toBeInTheDocument();
});

it.each([
  ["Add the widget cache", "Approved"],
  ["Fix the build", "Changes requested"],
  ["Write the docs", "Review required"],
])("shows the review state of %s as %s", async (title, label) => {
  await openPullRequests();

  expect((await pullRequestRow(title)).getByText(label)).toBeInTheDocument();
});

it("shows no review state for a pull request nobody has to review yet", async () => {
  await openPullRequests();

  const row = await pullRequestRow("Rework the parser");
  expect(row.queryByText(/approved|changes requested|review required/i)).not.toBeInTheDocument();
});

it("says so when the Repository has no open pull requests", async () => {
  await openPullRequests({ ...github, pullRequests: {} });

  expect(await screen.findByText("No open pull requests.")).toBeInTheDocument();
});

it("explains that pull requests are disabled when the remote is not on GitHub", async () => {
  await openPullRequests({ ...github, remotes: {} });

  expect(await screen.findByText(/disabled/i)).toHaveTextContent(
    "Pull requests are disabled: this Repository has no GitHub remote.",
  );
  expect(screen.queryByRole("list")).not.toBeInTheDocument();
  expect(screen.queryByLabelText(/personal access token/i)).not.toBeInTheDocument();
});

describe("when nobody is signed in", () => {
  const signedOut: StubGitHub = { ...github, signedInWith: null };

  it("asks for a token instead of listing pull requests", async () => {
    await openPullRequests(signedOut);

    expect(await screen.findByLabelText("Personal access token")).toBeInTheDocument();
    expect(screen.getByText(/gh auth login/)).toBeInTheDocument();
    expect(screen.queryByText("Add the widget cache")).not.toBeInTheDocument();
  });

  it("lists the pull requests once a valid token is pasted", async () => {
    const { user } = await openPullRequests(signedOut);

    await user.type(await screen.findByLabelText("Personal access token"), "good-token");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText("Add the widget cache")).toBeInTheDocument();
    expect(screen.queryByLabelText("Personal access token")).not.toBeInTheDocument();
  });

  it("keeps asking and explains when GitHub rejects the token", async () => {
    const { user } = await openPullRequests(signedOut);

    await user.type(await screen.findByLabelText("Personal access token"), "bad-token");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("GitHub did not accept the token.");
    expect(screen.getByLabelText("Personal access token")).toBeInTheDocument();
  });

  it("does not sign in with an empty token", async () => {
    await openPullRequests(signedOut);

    expect(await screen.findByRole("button", { name: "Sign in" })).toBeDisabled();
  });
});

describe("signing out", () => {
  it("is not offered when the token comes from the gh CLI", async () => {
    await openPullRequests();

    await screen.findByText("Add the widget cache");
    expect(screen.queryByRole("button", { name: /sign out/i })).not.toBeInTheDocument();
  });

  it("forgets a pasted token and asks for one again", async () => {
    const { user } = await openPullRequests({ ...github, signedInWith: "personalAccessToken" });

    await user.click(await screen.findByRole("button", { name: "Sign out of GitHub" }));

    expect(await screen.findByLabelText("Personal access token")).toBeInTheDocument();
    expect(screen.queryByText("Add the widget cache")).not.toBeInTheDocument();
  });
});

it("shows nothing to list before a Repository is open", async () => {
  const user = userEvent.setup();
  renderApp({ api: createStubCoreApi({}, {}, {}, {}, github) });

  await user.click(screen.getByRole("button", { name: "Pull requests" }));

  expect(screen.getByRole("main")).toHaveTextContent("Nothing here yet");
});

it("reports a failure to reach GitHub", async () => {
  const user = userEvent.setup();
  const api = createStubCoreApi({ [worktree]: sampleTab }, {}, {}, {}, github);
  api.pullRequests = async () => {
    throw { kind: "githubRequestFailed", message: "could not reach GitHub: offline" };
  };
  renderApp({ api, pickFolder: async () => worktree });
  await user.click(screen.getByRole("button", { name: /open folder/i }));
  await screen.findByRole("tab");
  await user.click(screen.getByRole("button", { name: "Pull requests" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("could not reach GitHub: offline");
});
