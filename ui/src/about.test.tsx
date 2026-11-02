import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { createStubCoreApi } from "./core/stub";
import { renderApp } from "./test-support";

const issuesUrl = "https://github.com/Constelutions/rebasar/issues";

function apiOpeningLinks() {
  const opened: string[] = [];
  const api = {
    ...createStubCoreApi(),
    async openInBrowser(url: string) {
      opened.push(url);
    },
  };
  return { api, opened };
}

async function runFromPalette(user: ReturnType<typeof userEvent.setup>, command: string) {
  await user.keyboard("{Control>}p{/Control}");
  await user.type(await screen.findByRole("combobox", { name: "Search or run" }), command);
  await user.keyboard("{Enter}");
}

it("shows the version, the license and a way to report an issue from the palette", async () => {
  const user = userEvent.setup();
  renderApp();

  await runFromPalette(user, "About");

  const dialog = await screen.findByRole("dialog", { name: "About Rebasar" });
  expect(await within(dialog).findByText(/0\.0\.0-test/)).toBeInTheDocument();
  expect(within(dialog).getByText(/Apache License 2\.0/)).toBeInTheDocument();
  expect(within(dialog).getByRole("button", { name: "Report an issue" })).toBeInTheDocument();
});

it("opens the public issues page from the About dialog", async () => {
  const user = userEvent.setup();
  const { api, opened } = apiOpeningLinks();
  renderApp({ api });

  await runFromPalette(user, "About");
  const dialog = await screen.findByRole("dialog", { name: "About Rebasar" });
  await user.click(within(dialog).getByRole("button", { name: "Report an issue" }));

  expect(opened).toEqual([issuesUrl]);
});

it("reports an issue straight from the palette without opening the dialog", async () => {
  const user = userEvent.setup();
  const { api, opened } = apiOpeningLinks();
  renderApp({ api });

  await runFromPalette(user, "Report an issue");

  expect(opened).toEqual([issuesUrl]);
  expect(screen.queryByRole("dialog", { name: "About Rebasar" })).not.toBeInTheDocument();
});

it("closes the About dialog with Escape", async () => {
  const user = userEvent.setup();
  renderApp();

  await runFromPalette(user, "About");
  await screen.findByRole("dialog", { name: "About Rebasar" });
  await user.keyboard("{Escape}");

  expect(screen.queryByRole("dialog", { name: "About Rebasar" })).not.toBeInTheDocument();
});
