import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { createFakeWindow, renderApp } from "./test-support";

it("minimizes the window from the title bar", async () => {
  const user = userEvent.setup();
  const appWindow = createFakeWindow();
  renderApp({ appWindow });

  await user.click(screen.getByRole("button", { name: "Minimize" }));

  expect(appWindow.minimize).toHaveBeenCalledOnce();
});

it("maximizes or restores the window from the title bar", async () => {
  const user = userEvent.setup();
  const appWindow = createFakeWindow();
  renderApp({ appWindow });

  await user.click(screen.getByRole("button", { name: "Maximize" }));

  expect(appWindow.toggleMaximize).toHaveBeenCalledOnce();
});

it("closes the window from the title bar", async () => {
  const user = userEvent.setup();
  const appWindow = createFakeWindow();
  renderApp({ appWindow });

  await user.click(screen.getByRole("button", { name: "Close" }));

  expect(appWindow.close).toHaveBeenCalledOnce();
});

it("places the window controls last in the title bar", () => {
  renderApp();

  const controls = screen.getByRole("group", { name: "Window controls" });

  expect(controls.parentElement?.lastElementChild).toBe(controls);
});
