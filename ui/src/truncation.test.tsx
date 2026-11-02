import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";

import { TruncatedText } from "./components/TruncatedText";
import { defaultSettings } from "./core/api";
import { SettingsProvider } from "./settings/SettingsContext";

function withSettings(children: ReactNode) {
  return (
    <SettingsProvider value={{ settings: defaultSettings, ready: true, error: null, update: () => {} }}>
      {children}
    </SettingsProvider>
  );
}

function measure(scrollWidth: number, clientWidth: number) {
  Object.defineProperty(HTMLElement.prototype, "scrollWidth", { configurable: true, get: () => scrollWidth });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => clientWidth });
}

afterEach(() => {
  // @ts-expect-error restores jsdom's own zero-width measurements
  delete HTMLElement.prototype.scrollWidth;
  // @ts-expect-error restores jsdom's own zero-width measurements
  delete HTMLElement.prototype.clientWidth;
});

it("shows the full text in a tooltip when the text is cut", async () => {
  measure(300, 100);
  const user = userEvent.setup();
  render(withSettings(<TruncatedText text="feat/publish-stable-on-push-to-main" />));

  await user.hover(screen.getByText("feat/publish-stable-on-push-to-main"));

  expect(await screen.findByRole("tooltip")).toHaveTextContent("feat/publish-stable-on-push-to-main");
});

it("shows no tooltip when the text fits", async () => {
  measure(100, 100);
  const user = userEvent.setup();
  render(withSettings(<TruncatedText text="main" />));

  await user.hover(screen.getByText("main"));
  await new Promise((resolve) => setTimeout(resolve, 500));

  expect(screen.queryByRole("tooltip")).toBeNull();
});

it("keeps the tooltip open while the pointer is inside it so its text can be selected", async () => {
  measure(300, 100);
  const user = userEvent.setup();
  render(withSettings(<TruncatedText text="a-long-branch-name" />));

  const trigger = screen.getByText("a-long-branch-name");
  await user.hover(trigger);
  const tooltip = await screen.findByRole("tooltip");
  await user.unhover(trigger);
  await user.hover(tooltip);
  await new Promise((resolve) => setTimeout(resolve, 300));

  expect(screen.getByRole("tooltip")).toBeInTheDocument();

  await user.unhover(tooltip);
  await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull());
});

it("marks a path to be cut from its start so that the file name stays visible", () => {
  render(withSettings(<TruncatedText path text="plugins/skills/dependabot-consolidate/SKILL.md" />));

  const path = screen.getByText("plugins/skills/dependabot-consolidate/SKILL.md");

  expect(path.closest(".truncate-path")).not.toBeNull();
});
