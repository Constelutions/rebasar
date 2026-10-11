import { screen } from "@testing-library/react";

import type { GitSetup } from "./core/api";
import { createStubCoreApi } from "./core/stub";
import { renderApp } from "./test-support";

function renderWithGit(setup: GitSetup) {
  renderApp({ api: createStubCoreApi({}, {}, {}, {}, {}, setup) });
}

it("explains what to install when git is missing and offers no views", async () => {
  renderWithGit({ kind: "missing", minimum: "2.35.0" });

  expect(await screen.findByRole("heading", { name: /git needs to be installed/i })).toBeVisible();
  expect(screen.getByText(/could not find git/i)).toBeVisible();
  expect(screen.getByText(/2\.35\.0 or newer/)).toBeVisible();
  expect(screen.queryByRole("navigation", { name: "Views" })).not.toBeInTheDocument();
});

it("says which version was found when git is too old", async () => {
  renderWithGit({ kind: "tooOld", version: "2.30.1", minimum: "2.35.0" });

  expect(await screen.findByText(/found git 2\.30\.1, which is too old/i)).toBeVisible();
  expect(screen.getByText(/2\.35\.0 or newer/)).toBeVisible();
});

it("shows the normal app when git is ready", async () => {
  renderWithGit({ kind: "ready", version: "2.47.1" });

  expect(await screen.findByRole("navigation", { name: "Views" })).toBeVisible();
  expect(screen.queryByRole("heading", { name: /git needs to be installed/i })).not.toBeInTheDocument();
});

it("keeps the window controls available on the setup screen", async () => {
  renderWithGit({ kind: "missing", minimum: "2.35.0" });
  await screen.findByRole("heading", { name: /git needs to be installed/i });

  expect(screen.getByRole("button", { name: /close/i })).toBeInTheDocument();
});
