import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { OutputPanel } from "./components/OutputPanel";
import { defaultSettings } from "./core/api";
import { SettingsProvider } from "./settings/SettingsContext";
import type { MutationRun } from "./useMutations";

function run(id: number, lineCount: number): MutationRun {
  return {
    id,
    title: "Pull",
    state: { kind: "succeeded" },
    command: "git pull",
    lines: Array.from({ length: lineCount }, (_, index) => ({ stream: "stdout" as const, transient: false, text: `line ${index}` })),
  };
}

function panel(runs: MutationRun[]) {
  return (
    <SettingsProvider value={{ settings: defaultSettings, ready: true, error: null, update: () => {} }}>
      <OutputPanel runs={runs} onCancel={() => {}} />
    </SettingsProvider>
  );
}

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", { configurable: true, get: () => 1000 });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 200 });
});

afterEach(() => {
  // @ts-expect-error restores jsdom's own zero measurements
  delete HTMLElement.prototype.scrollHeight;
  // @ts-expect-error restores jsdom's own zero measurements
  delete HTMLElement.prototype.clientHeight;
});

async function expand(runs: MutationRun[]) {
  const user = userEvent.setup();
  const view = render(panel(runs));
  await user.click(screen.getByRole("button", { name: "Output" }));
  return { view, body: document.querySelector<HTMLElement>(".output-body")! };
}

it("scrolls to the newest line when the panel is expanded", async () => {
  const { body } = await expand([run(1, 5)]);

  expect(body.scrollTop).toBe(1000);
});

it("follows new lines while it is at the bottom", async () => {
  const { view, body } = await expand([run(1, 5)]);

  body.scrollTop = 1000;
  view.rerender(panel([run(1, 9)]));

  expect(body.scrollTop).toBe(1000);
});

it("stops following once the user scrolls up and resumes at the bottom", async () => {
  const { view, body } = await expand([run(1, 5)]);

  body.scrollTop = 100;
  fireEvent.scroll(body);
  view.rerender(panel([run(1, 9)]));
  expect(body.scrollTop).toBe(100);

  body.scrollTop = 800;
  fireEvent.scroll(body);
  view.rerender(panel([run(1, 12)]));
  expect(body.scrollTop).toBe(1000);
});

it("follows again when a new run starts", async () => {
  const { view, body } = await expand([run(1, 5)]);

  body.scrollTop = 100;
  fireEvent.scroll(body);
  view.rerender(panel([run(1, 5), run(2, 1)]));

  expect(body.scrollTop).toBe(1000);
});
