import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { PullRequest, PullRequestsUnavailable } from "./core/api";
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

it("says there are no remotes when the Repository has none", async () => {
  await openPullRequests({ ...github, remotes: {} });

  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("This Repository has no remotes.");
  expect(alert).toHaveTextContent("git remote add origin <url>");
  expect(screen.queryByRole("list")).not.toBeInTheDocument();
  expect(screen.queryByLabelText(/personal access token/i)).not.toBeInTheDocument();
});

function unavailable(
  reason: PullRequestsUnavailable["reason"],
  message: string,
  url: string | null,
  hint: string | null,
): PullRequestsUnavailable {
  return { kind: "pullRequestsUnavailable", reason, message, url, hint };
}

async function openFailingPullRequests(error: PullRequestsUnavailable) {
  const user = userEvent.setup();
  const api = createStubCoreApi({ [worktree]: sampleTab }, {}, {}, {}, github);
  api.pullRequests = async () => {
    throw error;
  };
  renderApp({ api, pickFolder: async () => worktree });
  await user.click(screen.getByRole("button", { name: /open folder/i }));
  await screen.findByRole("tab");
  await user.click(screen.getByRole("button", { name: "Pull requests" }));
}

describe("when the pull requests cannot be shown", () => {
  it.each([
    [
      "the remote is not on GitHub",
      unavailable(
        { kind: "notGithub", host: "gitlab.com" },
        "The remote (gitlab.com) is not on GitHub.",
        "https://gitlab.com/acme/widgets.git",
        null,
      ),
    ],
    [
      "an SSH alias cannot be resolved",
      unavailable(
        { kind: "aliasUnresolved", alias: "github-personal", detail: "ssh is not available: not found" },
        "Could not resolve the SSH host alias github-personal: ssh is not available: not found",
        "git@github-personal:acme/widgets.git",
        "Check the Host entry for github-personal in your SSH configuration.",
      ),
    ],
    [
      "the Repository is not visible to the token",
      unavailable(
        { kind: "repositoryNotVisible", repository: "acme/widgets" },
        "GitHub has no Repository acme/widgets visible to this token.",
        "https://github.com/acme/widgets.git",
        "Check that the token can read this Repository.",
      ),
    ],
    [
      "GitHub cannot be reached",
      unavailable(
        { kind: "requestFailed", message: "could not reach GitHub: offline" },
        "could not reach GitHub: offline",
        "https://github.com/acme/widgets.git",
        "Check your network connection and try again.",
      ),
    ],
  ])("names the reason, the URL looked at and the hint when %s", async (_, error) => {
    await openFailingPullRequests(error);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(error.message);
    if (error.url) expect(alert).toHaveTextContent(error.url);
    if (error.hint) expect(alert).toHaveTextContent(error.hint);
  });

  it("sets a command quoted in the hint in code style", async () => {
    await openFailingPullRequests(
      unavailable({ kind: "noRemotes" }, "This Repository has no remotes.", null, "Run `git remote add origin <url>`."),
    );

    expect(await screen.findByText("git remote add origin <url>", { selector: "code" })).toBeInTheDocument();
  });
});

describe("when nobody is signed in", () => {
  const signedOut: StubGitHub = { ...github, signedInWith: null };

  it("asks for a token instead of listing pull requests", async () => {
    await openPullRequests(signedOut);

    expect(await screen.findByLabelText("Personal access token")).toBeInTheDocument();
    expect(screen.getByText(/gh auth login/)).toBeInTheDocument();
    expect(screen.queryByText("Add the widget cache")).not.toBeInTheDocument();
  });

  it("says why and which remote it looked at", async () => {
    await openPullRequests(signedOut);

    expect(await screen.findByText("You are not signed in to GitHub.")).toBeInTheDocument();
    expect(screen.getByText("https://github.com/acme/widgets.git")).toBeInTheDocument();
  });

  it("explains when the token that was kept stopped working", async () => {
    await openFailingPullRequests(
      unavailable(
        { kind: "tokenRejected" },
        "GitHub did not accept the token.",
        "https://github.com/acme/widgets.git",
        "Run `gh auth login` again, or paste a new personal access token.",
      ),
    );

    expect(await screen.findByText("GitHub did not accept the token.")).toBeInTheDocument();
    expect(screen.getByText("https://github.com/acme/widgets.git")).toBeInTheDocument();
    expect(screen.getByLabelText("Personal access token")).toBeInTheDocument();
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

describe("when the app has nowhere to store a token on this platform", () => {
  const noCredentialStore: StubGitHub = { ...github, signedInWith: null, canStoreToken: false };

  it("says so and points to the gh CLI instead of offering a token field", async () => {
    await openPullRequests(noCredentialStore);

    const notice = await screen.findByText(/Credentials are not stored on this platform yet/);
    expect(notice).toHaveAttribute("role", "status");
    expect(notice).toHaveTextContent("gh auth login");
    expect(screen.queryByLabelText("Personal access token")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sign in" })).not.toBeInTheDocument();
  });

  it("still says which remote it looked at", async () => {
    await openPullRequests(noCredentialStore);

    expect(await screen.findByText("https://github.com/acme/widgets.git")).toBeInTheDocument();
  });

  it("does not show the notice where a token can be stored", async () => {
    await openPullRequests({ ...github, signedInWith: null });

    await screen.findByLabelText("Personal access token");
    expect(screen.queryByText(/not stored on this platform/)).not.toBeInTheDocument();
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
    throw unavailable(
      { kind: "requestFailed", message: "could not reach GitHub: offline" },
      "could not reach GitHub: offline",
      null,
      null,
    );
  };
  renderApp({ api, pickFolder: async () => worktree });
  await user.click(screen.getByRole("button", { name: /open folder/i }));
  await screen.findByRole("tab");
  await user.click(screen.getByRole("button", { name: "Pull requests" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("could not reach GitHub: offline");
});
