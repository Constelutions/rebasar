import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { App } from "./App";
import type { Tab } from "./core/api";
import { createStubCoreApi } from "./core/stub";

const sample: Tab = {
  repositoryName: "sample",
  worktreePath: "C:\\work\\sample",
  head: { kind: "branch", name: "main" },
};

async function openFolder(path: string | null, repositories: Record<string, Tab>) {
  const user = userEvent.setup();
  render(<App api={createStubCoreApi(repositories)} pickFolder={async () => path} />);
  await user.click(screen.getByRole("button", { name: /open folder/i }));
}

it("shows an opened Repository as a Tab with its name and current branch", async () => {
  await openFolder(sample.worktreePath, { [sample.worktreePath]: sample });

  const tab = await screen.findByRole("tab", { name: /sample/ });
  expect(tab).toHaveTextContent("sample");
  expect(tab).toHaveTextContent("main");
});

it("shows the short commit for a detached HEAD", async () => {
  const detached: Tab = { ...sample, head: { kind: "detached", commit: "abc1234" } };
  await openFolder(detached.worktreePath, { [detached.worktreePath]: detached });

  expect(await screen.findByRole("tab")).toHaveTextContent("abc1234");
});

it("explains that a folder is not a Git repository and shows no Tab", async () => {
  await openFolder("C:\\work\\plain", {});

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "C:\\work\\plain is not a Git repository",
  );
  expect(screen.queryByRole("tab")).not.toBeInTheDocument();
});

it("does nothing when the folder picker is cancelled", async () => {
  await openFolder(null, { [sample.worktreePath]: sample });

  expect(screen.queryByRole("tab")).not.toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("shows a single Tab when the same Worktree is opened twice", async () => {
  const user = userEvent.setup();
  render(
    <App
      api={createStubCoreApi({ [sample.worktreePath]: sample })}
      pickFolder={async () => sample.worktreePath}
    />,
  );

  await user.click(screen.getByRole("button", { name: /open folder/i }));
  await user.click(screen.getByRole("button", { name: /open folder/i }));

  expect(await screen.findAllByRole("tab")).toHaveLength(1);
});
