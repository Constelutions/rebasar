import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, vi } from "vitest";

import { type Settings, defaultSettings } from "./core/api";
import { createStubCoreApi } from "./core/stub";
import { renderApp, sampleTab } from "./test-support";

const worktree = sampleTab.worktreePath;

interface OpenOptions {
  settings?: Settings;
  staged?: boolean;
}

async function open({ settings = defaultSettings, staged = false }: OpenOptions = {}) {
  const user = userEvent.setup();
  const api = createStubCoreApi(
    { [worktree]: sampleTab },
    {
      [worktree]: {
        conflicts: [],
        staged: staged ? [{ path: "a.txt", originalPath: null, kind: "modified", added: 1, removed: 0 }] : [],
        unstaged: [],
      },
    },
    {},
    {},
    {},
    undefined,
    { settings },
  );
  return { user, api, mount: () => mountApp(user, api) };
}

async function mountApp(user: ReturnType<typeof userEvent.setup>, api: ReturnType<typeof createStubCoreApi>) {
  renderApp({ api, pickFolder: async () => worktree });
  await user.click(screen.getByRole("button", { name: /open folder/i }));
  await screen.findByRole("tab");
  return screen.findByRole("group", { name: "Sync" });
}

/** The Sync buttons share words with sidebar entries such as Pull requests, so look inside the group. */
async function syncButton(name: "Pull" | "Push") {
  const group = await screen.findByRole("group", { name: "Sync" });
  return within(group).getByRole("button", { name: new RegExp(`^${name}`) });
}

afterEach(() => {
  vi.useRealTimers();
});

it("shows how far the branch is ahead and behind as badges on the Pull and Push icons", async () => {
  const { api, mount } = await open();
  api.setSyncStatus(worktree, { ahead: 2, behind: 3 });

  await mount();

  await waitFor(async () => expect(await syncButton("Pull")).toHaveTextContent("↓3"));
  expect(await syncButton("Push")).toHaveTextContent("↑2");
});

it("shows Fetch, Pull and Push as icons with no label text, named for assistive technology", async () => {
  const { mount } = await open();
  await mount();

  for (const name of ["Fetch", "Pull", "Push"] as const) {
    const button = name === "Fetch" ? screen.getByRole("button", { name }) : await syncButton(name);
    expect(button.querySelector("svg")).not.toBeNull();
    expect(button.textContent?.replace(/[↓↑\d\s]/g, "")).toBe("");
  }
});

it("gives each icon a tooltip that names the action", async () => {
  const { api, mount } = await open();
  api.setSyncStatus(worktree, { upstream: "origin/main" });
  await mount();

  expect(await screen.findByRole("button", { name: "Fetch" })).toHaveAttribute("title", "Fetch");
  await waitFor(async () => expect(await syncButton("Pull")).toHaveAttribute("title", "Pull from origin/main"));
  expect(await syncButton("Push")).toHaveAttribute("title", "Push to origin/main");
});

it("disables Pull and Push on a detached HEAD but leaves Fetch usable", async () => {
  const { api, mount } = await open();
  api.setSyncStatus(worktree, { branch: null, upstream: null });
  await mount();

  await waitFor(async () => expect(await syncButton("Pull")).toBeDisabled());
  expect(await syncButton("Push")).toBeDisabled();
  expect(screen.getByRole("button", { name: "Fetch" })).toBeEnabled();
});

it("disables Pull and Push while an action is running", async () => {
  const { user, api, mount } = await open();
  let release = () => {};
  const slow = {
    ...api,
    push: () => new Promise<void>((resolve) => (release = resolve)),
  };
  api.setSyncStatus(worktree, { ahead: 1 });
  renderApp({ api: slow as unknown as typeof api, pickFolder: async () => worktree });
  void mount;
  await user.click(screen.getByRole("button", { name: /open folder/i }));
  await screen.findByRole("tab");

  await user.click(await syncButton("Push"));

  expect(await syncButton("Pull")).toBeDisabled();
  expect(await syncButton("Push")).toBeDisabled();
  expect(screen.getByRole("button", { name: "Fetch" })).toBeDisabled();
  release();
});

it("fetches once when the Tab is first shown", async () => {
  const { api, mount } = await open();

  await mount();

  await waitFor(() => expect(api.syncActions).toEqual(["fetch"]));
});

it("does not fetch by itself when automatic fetching is off", async () => {
  const { api, mount } = await open({
    settings: { ...defaultSettings, sync: { autoFetch: false, fetchIntervalMinutes: 5 } },
  });

  await mount();
  await screen.findByRole("button", { name: "Fetch" });

  expect(api.syncActions).toEqual([]);
});

it("fetches again every configured interval", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const { api, mount } = await open({
    settings: { ...defaultSettings, sync: { autoFetch: true, fetchIntervalMinutes: 2 } },
  });
  await mount();
  await waitFor(() => expect(api.syncActions).toEqual(["fetch"]));

  await act(() => vi.advanceTimersByTimeAsync(2 * 60_000));

  await waitFor(() => expect(api.syncActions).toEqual(["fetch", "fetch"]));
});

it("shows a fetch failed indicator instead of an error when the background fetch fails", async () => {
  const { api, mount } = await open();
  api.failNextMutation({ exitCode: 128, output: ["fatal: could not read Username"] });

  await mount();

  expect(await screen.findByText("Fetch failed")).toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("fetches on demand", async () => {
  const { user, api, mount } = await open({
    settings: { ...defaultSettings, sync: { autoFetch: false, fetchIntervalMinutes: 5 } },
  });
  await mount();

  await user.click(screen.getByRole("button", { name: "Fetch" }));

  await waitFor(() => expect(api.syncActions).toEqual(["fetch"]));
});

it("pulls straight away when Git's configuration decides how", async () => {
  const { user, api, mount } = await open();
  api.setSyncStatus(worktree, { behind: 2 });
  await mount();

  await user.click(await syncButton("Pull"));

  await waitFor(() => expect(api.syncActions).toContain("pull"));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("asks merge, rebase or cancel once when the branch has diverged and nothing is configured", async () => {
  const { user, api, mount } = await open();
  api.setSyncStatus(worktree, { ahead: 1, behind: 1 });
  await mount();

  await user.click(await syncButton("Pull"));
  const dialog = await screen.findByRole("dialog", { name: "This branch has diverged" });
  await user.click(within(dialog).getByRole("checkbox", { name: /Remember/ }));
  await user.click(within(dialog).getByRole("button", { name: "Rebase" }));

  await waitFor(() => expect(api.syncActions).toContain("pull:rebase:remember"));

  await user.click(await syncButton("Pull"));
  await waitFor(() => expect(api.syncActions.at(-1)).toBe("pull"));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("pulls nothing when the question is cancelled", async () => {
  const { user, api, mount } = await open();
  api.setSyncStatus(worktree, { ahead: 1, behind: 1 });
  await mount();

  await user.click(await syncButton("Pull"));
  await user.click(await screen.findByRole("button", { name: "Cancel" }));

  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(api.syncActions.filter((action) => action.startsWith("pull"))).toEqual([]);
});

it("pushes the branch", async () => {
  const { user, api, mount } = await open();
  api.setSyncStatus(worktree, { ahead: 1 });
  await mount();

  await user.click(await syncButton("Push"));
  await waitFor(() => expect(api.syncActions).toContain("push"));

  await waitFor(async () => expect(await syncButton("Push")).not.toHaveTextContent("↑"));
});

it("offers a force push only when the branch has diverged and asks for confirmation naming the loss", async () => {
  const { user, api, mount } = await open();
  api.setSyncStatus(worktree, { ahead: 1, behind: 0 });
  await mount();
  await syncButton("Push");
  expect(screen.queryByRole("button", { name: "Force push" })).not.toBeInTheDocument();

  api.setSyncStatus(worktree, { ahead: 1, behind: 2 });
  await user.click(await screen.findByRole("button", { name: "Force push" }));
  const dialog = await screen.findByRole("alertdialog", { name: "Force push" });

  expect(dialog).toHaveTextContent("2 commits will no longer be reachable");
  expect(api.syncActions).not.toContain("forcePush");
  await user.click(within(dialog).getByRole("button", { name: "Force push" }));
  await waitFor(() => expect(api.syncActions).toContain("forcePush"));
});

it("explains what to do when authentication fails instead of hanging", async () => {
  const { user, api, mount } = await open();
  const message = "The remote did not accept your credentials. Sign in again through Git Credential Manager.";
  const failing = {
    ...api,
    push: async () => {
      throw { kind: "gitFailed", message };
    },
  };
  api.setSyncStatus(worktree, { ahead: 1 });
  renderApp({ api: failing, pickFolder: async () => worktree });
  await user.click(screen.getByRole("button", { name: /open folder/i }));
  await screen.findByRole("tab");
  void mount;

  await user.click(await syncButton("Push"));

  expect(await screen.findByRole("alert")).toHaveTextContent("Credential Manager");
});

it("pushes after committing with Commit & Push", async () => {
  const { user, api, mount } = await open({ staged: true });
  await mount();
  await user.click(screen.getByRole("button", { name: "Changes" }));

  await user.type(await screen.findByLabelText("Commit message"), "feat: add things");
  await user.click(screen.getByRole("button", { name: "Commit & Push" }));

  await waitFor(() => expect(api.syncActions).toContain("push"));
});

it("does not push after a plain Commit", async () => {
  const { user, api, mount } = await open({ staged: true });
  await mount();
  await user.click(screen.getByRole("button", { name: "Changes" }));

  await user.type(await screen.findByLabelText("Commit message"), "feat: add things");
  await user.click(screen.getByRole("button", { name: "Commit" }));

  await waitFor(() => expect(api.commits).toHaveLength(1));
  expect(api.syncActions).not.toContain("push");
});
