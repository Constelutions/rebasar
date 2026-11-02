import { fireEvent, render, screen } from "@testing-library/react";

import { TabStrip } from "./components/TabStrip";
import { sampleTab } from "./test-support";
import type { OpenTab } from "./useOpenTabs";

const tabs: OpenTab[] = ["a", "b", "c"].map((name) => ({
  tab: { ...sampleTab, repositoryName: name, worktreePath: `C:\work\${name}` },
  status: null,
  operation: null,
  error: null,
}));

function overflow() {
  Object.defineProperty(HTMLElement.prototype, "scrollWidth", { configurable: true, get: () => 600 });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 200 });
}

afterEach(() => {
  // @ts-expect-error restores jsdom's own zero-width measurements
  delete HTMLElement.prototype.scrollWidth;
  // @ts-expect-error restores jsdom's own zero-width measurements
  delete HTMLElement.prototype.clientWidth;
});

function renderStrip() {
  return render(<TabStrip tabs={tabs} activePath={tabs[0]?.tab.worktreePath} onSelect={() => {}} onClose={() => {}} />);
}

it("scrolls sideways when the mouse wheel turns over the strip", () => {
  overflow();
  renderStrip();
  const strip = screen.getByRole("tablist");

  fireEvent.wheel(strip, { deltaY: 120 });

  expect(strip.scrollLeft).toBe(120);
});

it("draws an overlay scrollbar only while the tabs overflow", () => {
  const { container, unmount } = renderStrip();
  expect(container.querySelector(".tab-scrollbar")).toBeNull();
  unmount();

  overflow();
  const overflowing = renderStrip();
  expect(overflowing.container.querySelector(".tab-scrollbar-thumb")).not.toBeNull();
});
