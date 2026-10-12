import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { FileChange, StashInfo, StashPreview } from "./core/api";
import { createStubCoreApi } from "./core/stub";
import { renderApp, sampleTab } from "./test-support";

const worktree = sampleTab.worktreePath;

function change(path: string): FileChange {
  return { path, originalPath: null, kind: "modified", added: 2, removed: 1 };
}

function stash(id: string, message: string, branch = "main"): { info: StashInfo; preview: StashPreview } {
  return {
    info: { id: id.repeat(40), shortId: id.repeat(7), message, branch, timestamp: 1_767_614_400 },
    preview: { files: [change(`${message.replace(/\W+/g, "-")}.ts`)], untracked: [] },
  };
}

const first = stash("a", "On main: Park login");
const second = stash("b", "WIP on main: 1234567 Latest");

async function openStashes(stashes = [first, second]) {
  const user = userEvent.setup();
  const api = createStubCoreApi({ [worktree]: sampleTab });
  api.setStashes(worktree, stashes);
  renderApp({ api, pickFolder: async () => worktree });
  await user.click(screen.getByRole("button", { name: /open folder/i }));
  await screen.findByRole("tab");
  await user.click(screen.getByRole("button", { name: "Stashes" }));
  return { user, api };
}

it("lists stashes with their message, branch and time", async () => {
  await openStashes();

  const list = await screen.findByRole("list", { name: "Stashes" });
  const items = within(list).getAllByRole("listitem");

  expect(items).toHaveLength(2);
  expect(items[0]).toHaveTextContent("On main: Park login");
  expect(items[0]).toHaveTextContent("main ·");
  expect(items[0]?.querySelector("time")).toHaveAttribute("datetime", "2026-01-05T12:00:00.000Z");
});

it("says so when there are no stashes and asks to open a folder without a Tab", async () => {
  await openStashes([]);
  expect(await screen.findByText("No stashes.")).toBeInTheDocument();
});

it("asks to open a folder when there is no Tab", async () => {
  const user = userEvent.setup();
  renderApp({ api: createStubCoreApi() });

  await user.click(screen.getByRole("button", { name: "Stashes" }));

  expect(screen.getByText("Open a folder to see its stashes.")).toBeInTheDocument();
});

it("previews the files of the selected stash and their diffs", async () => {
  const { user } = await openStashes();

  const preview = await screen.findByRole("region", { name: "Stash On main: Park login" });
  expect(await within(preview).findByRole("list", { name: "Changed files" })).toHaveTextContent("On-main-Park-login.ts");

  await user.click(screen.getByRole("button", { name: "Show stash WIP on main: 1234567 Latest" }));

  expect(await screen.findByRole("region", { name: "Stash WIP on main: 1234567 Latest" })).toBeInTheDocument();
});

it("lists the untracked files a stash took along", async () => {
  const withUntracked = stash("c", "On main: With untracked");
  withUntracked.preview = { files: [], untracked: ["notes/new.txt"] };
  await openStashes([withUntracked]);

  const untracked = await screen.findByRole("region", { name: "Untracked files in this stash" });

  expect(untracked).toHaveTextContent("notes/new.txt");
});

it("creates a stash with a message", async () => {
  const { user, api } = await openStashes([]);
  await screen.findByText("No stashes.");

  await user.type(screen.getByRole("textbox", { name: "Stash message" }), "Park this");
  await user.click(screen.getByRole("button", { name: "Stash changes" }));

  await waitFor(() => expect(api.stashActions).toEqual(["create:Park this"]));
  expect(await screen.findByText("On main: Park this")).toBeInTheDocument();
});

it("creates a stash with untracked files when asked", async () => {
  const { user, api } = await openStashes([]);
  await screen.findByText("No stashes.");

  await user.click(screen.getByRole("checkbox", { name: "Include untracked files" }));
  await user.click(screen.getByRole("button", { name: "Stash changes" }));

  await waitFor(() => expect(api.stashActions).toEqual(["create::untracked"]));
});

it("applies a stash and keeps it", async () => {
  const { user, api } = await openStashes();

  await user.click(await screen.findByRole("button", { name: "Apply On main: Park login" }));

  await waitFor(() => expect(api.stashActions).toEqual([`apply:${"a".repeat(40)}`]));
  expect(screen.getByRole("list", { name: "Stashes" })).toHaveTextContent("On main: Park login");
});

it("pops a stash and removes it from the list", async () => {
  const { user, api } = await openStashes();

  await user.click(await screen.findByRole("button", { name: "Pop On main: Park login" }));

  await waitFor(() => expect(api.stashActions).toEqual([`pop:${"a".repeat(40)}`]));
  await waitFor(() =>
    expect(screen.getByRole("list", { name: "Stashes" })).not.toHaveTextContent("Park login"),
  );
});

it("asks before dropping, naming the files it holds, and drops only once confirmed", async () => {
  const { user, api } = await openStashes();

  await user.click(await screen.findByRole("button", { name: "Drop On main: Park login" }));
  const dialog = await screen.findByRole("alertdialog", { name: "Drop stash" });

  expect(dialog).toHaveTextContent("On-main-Park-login.ts");
  expect(api.stashActions).toEqual([]);
  await user.click(within(dialog).getByRole("button", { name: "Drop" }));
  await waitFor(() => expect(api.stashActions).toEqual([`drop:${"a".repeat(40)}`]));
});

it("keeps the stash when the drop is cancelled", async () => {
  const { user, api } = await openStashes();

  await user.click(await screen.findByRole("button", { name: "Drop On main: Park login" }));
  await user.click(await screen.findByRole("button", { name: "Cancel" }));

  expect(api.stashActions).toEqual([]);
});

it("points to the Conflicts view when applying fails on a conflict", async () => {
  const { user, api } = await openStashes();
  api.failNextMutation({ exitCode: 1, output: ["CONFLICT (content): Merge conflict in a.txt"] });

  await user.click(await screen.findByRole("button", { name: "Apply On main: Park login" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("Conflicts view");
});
