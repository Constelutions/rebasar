import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { createStubCoreApi } from "./core/stub";
import { renderApp, sampleTab } from "./test-support";

const sample = sampleTab;

function renderWithPicker() {
  const pickFolder = vi.fn(async () => sample.worktreePath);
  renderApp({ api: createStubCoreApi({ [sample.worktreePath]: sample }), pickFolder });
  return pickFolder;
}

it("opens a folder with Ctrl+O", async () => {
  const user = userEvent.setup();
  const pickFolder = renderWithPicker();

  await user.keyboard("{Control>}o{/Control}");

  expect(pickFolder).toHaveBeenCalledOnce();
  expect(await screen.findByRole("tab", { name: /sample/ })).toBeInTheDocument();
});

it("does not treat the Command key as the open-folder shortcut", async () => {
  const user = userEvent.setup();
  const pickFolder = renderWithPicker();

  await user.keyboard("{Meta>}o{/Meta}");

  expect(pickFolder).not.toHaveBeenCalled();
});

it("ignores a plain O keypress", async () => {
  const user = userEvent.setup();
  const pickFolder = renderWithPicker();

  await user.keyboard("o");

  expect(pickFolder).not.toHaveBeenCalled();
});

it("tells the user about the shortcut on the open-folder button", () => {
  renderWithPicker();

  expect(screen.getByRole("button", { name: "Open folder" })).toHaveAttribute(
    "title",
    "Open folder (Ctrl+O)",
  );
});
