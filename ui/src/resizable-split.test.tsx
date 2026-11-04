import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  type CoreApi,
  type FileDiff,
  type Settings,
  type SplitPosition,
  type WorktreeStatus,
  defaultSettings,
} from "./core/api";
import { commitDiffKey, commitKey, createStubCoreApi } from "./core/stub";
import { commitRow, renderApp, sampleTab } from "./test-support";

const worktree = sampleTab.worktreePath;
const commitId = "a".repeat(40);
const path = "src/parser.rs";
const SIZE = 1000;

const diff: FileDiff = {
  path,
  originalPath: null,
  modeChange: null,
  content: { kind: "text", hunks: [] },
};

const status: WorktreeStatus = {
  conflicts: [],
  staged: [{ path: "src/api.ts", originalPath: null, kind: "modified", added: 3, removed: 1 }],
  unstaged: [],
};

type View = "History" | "Changes";

const views = {
  History: { separator: "Resize commit detail", position: "detailPosition" },
  Changes: { separator: "Resize diff", position: "diffPosition" },
} as const;

function withPosition(view: View, position: SplitPosition) {
  return (api: CoreApi): CoreApi => ({
    ...api,
    settings: async (): Promise<Settings> => ({
      ...defaultSettings,
      history: { ...defaultSettings.history, detailPosition: view === "History" ? position : "right" },
      changes: { ...defaultSettings.changes, diffPosition: view === "Changes" ? position : "right" },
    }),
  });
}

async function openApp(position: SplitPosition = "right", view: View = "History") {
  const user = userEvent.setup();
  const api = withPosition(
    view,
    position,
  )(
    createStubCoreApi(
      { [worktree]: sampleTab },
      { [worktree]: status },
      { [worktree]: [commitRow({ id: commitId, subject: "Add the parser" })] },
      {},
      {},
      undefined,
      undefined,
      {
        commitDetails: {
          [commitKey(commitId, 0)]: {
            id: commitId,
            shortId: commitId.slice(0, 8),
            authorName: "Ada Lovelace",
            authorEmail: "ada@example.com",
            authorTimestamp: 1_700_000_000,
            message: "Add the parser",
            parents: [],
            files: [{ path, originalPath: null, kind: "modified", added: 1, removed: 0 }],
          },
        },
        commitDiffs: { [commitDiffKey({ commit: commitId, parent: 0, path })]: diff },
      },
    ),
  );
  renderApp({ api, pickFolder: async () => worktree });
  await user.click(screen.getByRole("button", { name: /open folder/i }));
  await screen.findByRole("tab");
  return { user, api };
}

async function showView(user: ReturnType<typeof userEvent.setup>, view: View) {
  await user.click(screen.getByRole("button", { name: view }));
  if (view === "Changes") {
    await screen.findByRole("list", { name: "Changed files" });
  } else {
    const history = await screen.findByRole("list", { name: "Commit history" });
    await user.click(within(history).getByText("Add the parser"));
    await screen.findByRole("region", { name: "Commit detail" });
  }
  const divider = screen.getByRole("separator", { name: views[view].separator });
  const split = divider.parentElement as HTMLElement;
  Object.defineProperty(split, "clientWidth", { value: SIZE, configurable: true });
  Object.defineProperty(split, "clientHeight", { value: SIZE, configurable: true });
  return divider;
}

function drag(divider: HTMLElement, from: { x: number; y: number }, to: { x: number; y: number }) {
  fireEvent.pointerDown(divider, { clientX: from.x, clientY: from.y, pointerId: 1 });
  fireEvent.pointerMove(divider, { clientX: to.x, clientY: to.y, pointerId: 1 });
  fireEvent.pointerUp(divider, { clientX: to.x, clientY: to.y, pointerId: 1 });
}

function share(divider: HTMLElement) {
  return Number(divider.getAttribute("aria-valuenow"));
}

const cases = [
  { view: "History", position: "right", orientation: "vertical", grow: "{ArrowRight}", shrink: "{ArrowLeft}" },
  { view: "History", position: "bottom", orientation: "horizontal", grow: "{ArrowDown}", shrink: "{ArrowUp}" },
  { view: "Changes", position: "right", orientation: "vertical", grow: "{ArrowRight}", shrink: "{ArrowLeft}" },
  { view: "Changes", position: "bottom", orientation: "horizontal", grow: "{ArrowDown}", shrink: "{ArrowUp}" },
] as const;

describe.each(cases)("the $view split with the detail at the $position", ({ view, position, orientation, grow, shrink }) => {
  const drags = {
    right: (delta: number) => ({ from: { x: 400, y: 0 }, to: { x: 400 + delta, y: 0 } }),
    bottom: (delta: number) => ({ from: { x: 0, y: 400 }, to: { x: 0, y: 400 + delta } }),
  }[position];

  it("exposes a separator with its current value, oriented along the axis", async () => {
    const { user } = await openApp(position, view);
    const divider = await showView(user, view);

    expect(divider).toHaveAttribute("aria-orientation", orientation);
    expect(divider).toHaveAttribute("aria-valuemin", "20");
    expect(divider).toHaveAttribute("aria-valuemax", "70");
    expect(share(divider)).toBe(40);
    expect(divider).toHaveAttribute("tabindex", "0");
  });

  it("resizes by dragging the divider along the axis", async () => {
    const { user } = await openApp(position, view);
    const divider = await showView(user, view);

    drag(divider, drags(100).from, drags(100).to);

    expect(share(divider)).toBe(50);
  });

  it("never lets a drag close either pane", async () => {
    const { user } = await openApp(position, view);
    const divider = await showView(user, view);

    drag(divider, drags(5000).from, drags(5000).to);
    expect(share(divider)).toBe(70);

    drag(divider, drags(-5000).from, drags(-5000).to);
    expect(share(divider)).toBe(20);
  });

  it("resizes with the arrow keys along the axis, within limits", async () => {
    const { user } = await openApp(position, view);
    const divider = await showView(user, view);

    divider.focus();
    await user.keyboard(grow);
    expect(share(divider)).toBe(44);

    await user.keyboard(shrink);
    await user.keyboard(shrink);
    expect(share(divider)).toBe(36);

    for (let press = 0; press < 30; press++) await user.keyboard(grow);
    expect(share(divider)).toBe(70);

    for (let press = 0; press < 60; press++) await user.keyboard(shrink);
    expect(share(divider)).toBe(20);
  });

  it("ignores the arrow keys of the other axis", async () => {
    const { user } = await openApp(position, view);
    const divider = await showView(user, view);
    const across = position === "right" ? "{ArrowDown}" : "{ArrowRight}";

    divider.focus();
    await user.keyboard(across);

    expect(share(divider)).toBe(40);
  });

  it("resets to the default size on double-click", async () => {
    const { user } = await openApp(position, view);
    const divider = await showView(user, view);
    drag(divider, drags(100).from, drags(100).to);

    await user.dblClick(divider);

    expect(share(divider)).toBe(40);
  });

  it("keeps the chosen size when the user switches views and comes back", async () => {
    const { user } = await openApp(position, view);
    const divider = await showView(user, view);
    drag(divider, drags(100).from, drags(100).to);
    const other = view === "History" ? "Changes" : "History";

    await showView(user, other);
    const back = await showView(user, view);

    expect(share(back)).toBe(50);
  });
});

describe("the size of the splits", () => {
  it("is kept apart for each view", async () => {
    const { user } = await openApp();
    const history = await showView(user, "History");
    drag(history, { x: 400, y: 0 }, { x: 500, y: 0 });

    const changes = await showView(user, "Changes");

    expect(share(changes)).toBe(40);
  });

  it("is not written to the settings", async () => {
    const { user, api } = await openApp();
    const divider = await showView(user, "Changes");
    const before = await api.settings();

    drag(divider, { x: 400, y: 0 }, { x: 500, y: 0 });
    await user.keyboard("{Escape}");

    expect(await api.settings()).toEqual(before);
  });
});
