import { act, screen } from "@testing-library/react";

import { createStubCoreApi } from "./core/stub";
import { renderApp } from "./test-support";

it("asks the core to open the path the app was started with once it is listening", async () => {
  const api = createStubCoreApi();

  renderApp({ api });

  await vi.waitFor(() => expect(api.launchPathRequests).toBe(1));
});

it("shows why a path handed to the running app could not be opened", async () => {
  const api = createStubCoreApi();
  renderApp({ api });
  await screen.findByRole("button", { name: /open folder/i });

  act(() => {
    api.emitEvent({ type: "launchFailed", message: "C:\\work\\nope is not a Git repository" });
  });

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "C:\\work\\nope is not a Git repository",
  );
});
