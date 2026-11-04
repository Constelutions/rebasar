import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { CoreApi } from "./core/api";
import { createStubCoreApi } from "./core/stub";
import { renderApp } from "./test-support";

function apiRunning(version: string): CoreApi {
  return { ...createStubCoreApi(), appInfo: async () => ({ version }) };
}

async function renderVersion(version: string) {
  const user = userEvent.setup();
  renderApp({ api: apiRunning(version) });
  await screen.findByRole("button", { name: `v${version}` });
  return user;
}

function aboutButton() {
  return screen.getByRole("button", { name: "About Rebasar" });
}

function aboutDialog() {
  return screen.findByRole("dialog", { name: "About Rebasar" });
}

describe("the logo in the title bar", () => {
  it("sits at the far left of the title bar", async () => {
    await renderVersion("0.1.0");

    const titleBar = aboutButton().parentElement;
    expect(titleBar?.tagName).toBe("HEADER");
    expect(titleBar?.firstElementChild).toBe(aboutButton());
    expect(within(aboutButton()).getByRole("img", { name: "Rebasar" })).toBeInTheDocument();
  });

  it("leaves the title bar draggable around the button, but not on it", async () => {
    await renderVersion("0.1.0");

    expect(aboutButton().parentElement).toHaveAttribute("data-tauri-drag-region");
    expect(aboutButton()).not.toHaveAttribute("data-tauri-drag-region");
  });

  it("says About Rebasar in its tooltip", async () => {
    await renderVersion("0.1.0");

    expect(aboutButton()).toHaveAttribute("title", "About Rebasar");
  });

  it("opens About when clicked", async () => {
    const user = await renderVersion("0.1.0");

    await user.click(aboutButton());

    expect(await aboutDialog()).toBeInTheDocument();
  });
});

describe("the Beta badge", () => {
  it.each(["0.4.2", "1.2.0-beta.3"])("shows next to the logo on the Beta build %s", async (version) => {
    await renderVersion(version);

    expect(within(aboutButton()).getByText("Beta")).toBeInTheDocument();
  });

  it("is absent on a Stable build", async () => {
    await renderVersion("1.2.0");

    expect(within(aboutButton()).queryByText("Beta")).not.toBeInTheDocument();
  });
});

describe("the version in the sidebar footer", () => {
  it("opens About when clicked", async () => {
    const user = await renderVersion("0.4.2");

    await user.click(screen.getByRole("button", { name: "v0.4.2" }));

    expect(await aboutDialog()).toBeInTheDocument();
  });

  it("is hidden while the sidebar is collapsed", async () => {
    const user = await renderVersion("0.4.2");

    await user.click(screen.getByRole("button", { name: "Collapse sidebar" }));

    expect(screen.queryByRole("button", { name: "v0.4.2" })).not.toBeInTheDocument();
  });
});

describe("the About dialog", () => {
  it.each([
    ["0.4.2", "Beta"],
    ["1.2.0-beta.3", "Beta"],
    ["1.2.0", "Stable"],
  ])("shows the wordmark, version %s, the %s Channel, the licence and a way to report an issue", async (version, channel) => {
    const user = await renderVersion(version);

    await user.click(aboutButton());

    const dialog = await aboutDialog();
    expect(within(dialog).getByRole("img", { name: "Rebasar" })).toBeInTheDocument();
    expect(within(dialog).getByText(`Version ${version}`)).toBeInTheDocument();
    expect(within(dialog).getByText(`Channel: ${channel}`)).toBeInTheDocument();
    expect(within(dialog).getByText(/Apache License 2\.0/)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Report an issue" })).toBeInTheDocument();
  });

  it("still opens from the palette command", async () => {
    const user = await renderVersion("0.4.2");

    await user.keyboard("{Control>}p{/Control}");
    await user.type(await screen.findByRole("combobox", { name: "Search or run" }), "About");
    await user.keyboard("{Enter}");

    expect(await aboutDialog()).toBeInTheDocument();
  });
});
