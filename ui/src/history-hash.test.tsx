import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { type CoreApi, defaultSettings } from "./core/api";
import { createStubCoreApi } from "./core/stub";
import { commitRow, renderApp, sampleTab, showHistory } from "./test-support";

const commitId = "0123456789abcdef0123456789abcdef01234567";

function withHashLength(hashLength: number | null) {
  return (api: CoreApi): CoreApi => ({
    ...api,
    settings: async () => ({ ...defaultSettings, copy: { ...defaultSettings.copy, hashLength } }),
  });
}

async function hashOfFirstCommit() {
  const commit = await screen.findByRole("listitem");
  return within(commit).getByRole("button", { name: /^Copy hash/ });
}

it("shows the first 8 characters of each commit hash", async () => {
  await showHistory([commitRow({ id: commitId })]);

  expect(await hashOfFirstCommit()).toHaveTextContent(/^01234567$/);
});

it("copies the full hash when it is clicked and says so in a tooltip", async () => {
  const user = await showHistory([commitRow({ id: commitId })]);

  await user.click(await hashOfFirstCommit());

  expect(await navigator.clipboard.readText()).toBe(commitId);
  expect(await screen.findByRole("tooltip")).toHaveTextContent("Copied");
});

it("copies only as many characters as the copy-hash length setting asks for", async () => {
  const user = await showHistory([commitRow({ id: commitId })], withHashLength(12));

  await user.click(await hashOfFirstCommit());

  await waitFor(async () => expect(await navigator.clipboard.readText()).toBe(commitId.slice(0, 12)));
});

it("copies the hash without selecting the commit", async () => {
  const user = await showHistory([commitRow({ id: commitId, subject: "Add the parser" })]);

  await user.click(await hashOfFirstCommit());

  await screen.findByRole("tooltip");
  expect(screen.getByRole("listitem")).not.toHaveAttribute("aria-current");
  expect(screen.queryByRole("button", { name: "Close commit detail" })).not.toBeInTheDocument();
});

it("titles the Author, Commit ID and Date columns of the vertical view", async () => {
  await showHistory([commitRow({ id: commitId })]);
  await screen.findByRole("listitem");

  const titles = screen.getByRole("group", { name: "Columns" });
  expect([...titles.children].map((title) => title.textContent)).toEqual(["", "Author", "Commit ID", "Date"]);
});

it("leaves the columns untitled in the horizontal view", async () => {
  const user = userEvent.setup();
  const api = createStubCoreApi(
    { [sampleTab.worktreePath]: sampleTab },
    {},
    { [sampleTab.worktreePath]: [commitRow({ id: commitId })] },
  );
  renderApp({ api, pickFolder: async () => sampleTab.worktreePath });
  await user.click(screen.getByRole("button", { name: /open folder/i }));
  await screen.findByRole("tab");
  await user.click(screen.getByRole("button", { name: "History" }));
  await screen.findByRole("listitem");

  await user.click(screen.getByRole("radio", { name: "Horizontal" }));

  expect(screen.queryByRole("group", { name: "Columns" })).not.toBeInTheDocument();
});
