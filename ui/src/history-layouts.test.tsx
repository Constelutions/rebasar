import { cleanup, screen, waitFor, within } from "@testing-library/react";

import { type CoreApi, type HistoryRow, type Settings, defaultSettings } from "./core/api";
import {
  commitRow,
  localTime,
  numberedCommits,
  scrollHistory,
  showHistory,
} from "./test-support";

const rowHeight = 36;

const styles = ["Tree", "Linear"] as const;

async function chooseStyle(user: Awaited<ReturnType<typeof showHistory>>, style: (typeof styles)[number]) {
  await user.click(screen.getByRole("radio", { name: style }));
}

function withHistorySettings(history: Partial<Settings["history"]>) {
  return (api: CoreApi): CoreApi => {
    const stored: Settings = { ...defaultSettings, history: { ...defaultSettings.history, ...history } };
    return { ...api, settings: async () => stored };
  };
}

function recordingPageRequests(requested: number[]) {
  return (api: CoreApi): CoreApi => ({
    ...api,
    historyPage: (path, offset, limit, filter) => {
      requested.push(offset);
      return api.historyPage(path, offset, limit, filter);
    },
  });
}

const branchingHistory: HistoryRow[] = [
  commitRow({
    id: "a".repeat(40),
    subject: "Merge feature",
    timestamp: localTime(2026, 1, 6, 9),
    lane: 0,
    laneCount: 2,
    edges: [
      { kind: "outgoing", lane: 0 },
      { kind: "outgoing", lane: 1 },
    ],
    refs: [{ kind: "localBranch", name: "main" }],
  }),
  commitRow({
    id: "b".repeat(40),
    subject: "Feature work",
    authorName: "Grace Hopper",
    timestamp: localTime(2026, 1, 5, 20),
    lane: 1,
    laneCount: 2,
    edges: [
      { kind: "through", lane: 0 },
      { kind: "incoming", lane: 1 },
      { kind: "outgoing", lane: 1 },
    ],
  }),
  commitRow({
    id: "c".repeat(40),
    subject: "Root commit",
    timestamp: localTime(2026, 1, 5, 8),
    laneCount: 2,
    edges: [
      { kind: "incoming", lane: 0 },
      { kind: "incoming", lane: 1 },
    ],
  }),
];

it("offers a tree graph by default and no choice of orientation", async () => {
  await showHistory(branchingHistory);

  expect(screen.getByRole("radio", { name: "Tree" })).toBeChecked();
  expect(screen.getByRole("radio", { name: "Linear" })).not.toBeChecked();
  expect(screen.queryByRole("radio", { name: "Horizontal" })).not.toBeInTheDocument();
  expect(screen.queryByRole("radio", { name: "Vertical" })).not.toBeInTheDocument();
  expect(screen.queryByRole("radiogroup", { name: "Orientation" })).not.toBeInTheDocument();
});

it("always lets Linear and Tree be chosen", async () => {
  const user = await showHistory(branchingHistory);

  expect(screen.getByRole("radio", { name: "Linear" })).toBeEnabled();
  expect(screen.getByRole("radio", { name: "Tree" })).toBeEnabled();

  await chooseStyle(user, "Linear");

  expect(screen.getByRole("radio", { name: "Linear" })).toBeEnabled();
  expect(screen.getByRole("radio", { name: "Tree" })).toBeEnabled();
});

it("keeps the chosen graph style the next time History is shown", async () => {
  let api!: CoreApi;
  const user = await showHistory(branchingHistory, (stub) => (api = stub));
  await chooseStyle(user, "Linear");

  cleanup();
  await showHistory(branchingHistory, () => api);

  expect(screen.getByRole("radio", { name: "Linear" })).toBeChecked();
});

it("stores the chosen graph style in the settings", async () => {
  let api!: CoreApi;
  const user = await showHistory(branchingHistory, (stub) => (api = stub));

  await chooseStyle(user, "Linear");

  await waitFor(async () => expect((await api.settings()).history.graphStyle).toBe("linear"));
});

it("opens with the graph style the settings ask for", async () => {
  await showHistory(branchingHistory, withHistorySettings({ graphStyle: "linear" }));

  expect(screen.getByRole("radio", { name: "Linear" })).toBeChecked();
});

it("opens vertically, with its columns titled, for settings that still name a horizontal orientation", async () => {
  await showHistory(
    branchingHistory,
    withHistorySettings({ graphStyle: "tree", ...({ orientation: "horizontal" } as object) }),
  );

  expect(await screen.findAllByRole("listitem")).toHaveLength(3);
  expect(screen.getByRole("group", { name: "Columns" })).toBeInTheDocument();
  expect(screen.queryByRole("radio", { name: "Horizontal" })).not.toBeInTheDocument();
  expect(screen.getByRole("radio", { name: "Linear" })).toBeEnabled();
});

it("ignores the layout an earlier version kept in the browser", async () => {
  localStorage.setItem("rebasar.history.layout", JSON.stringify({ orientation: "vertical", style: "linear" }));
  let api!: CoreApi;

  await showHistory(branchingHistory, (stub) => (api = stub));

  expect(screen.getByRole("radio", { name: "Tree" })).toBeChecked();
  expect((await api.settings()).history.graphStyle).toBe("tree");
  expect(localStorage.getItem("rebasar.history.layout")).not.toBeNull();
});

describe.each(styles)("%s graph style", (style) => {
  it("shows each commit with its message, author, hash, labels and day heading", async () => {
    const user = await showHistory(branchingHistory);
    await chooseStyle(user, style);

    const commits = await screen.findAllByRole("listitem");
    expect(commits).toHaveLength(3);
    expect(commits[0]).toHaveTextContent("Merge feature");
    expect(commits[0]).toHaveTextContent("aaaaaaa");
    expect(within(commits[0]!).getByText("main")).toBeInTheDocument();
    expect(commits[1]).toHaveTextContent("Grace Hopper");
    expect(screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent)).toEqual([
      "Tuesday, January 6, 2026",
      "Monday, January 5, 2026",
    ]);
  });

  it("renders only the commits around the viewport and brings later ones into view by scrolling", async () => {
    const user = await showHistory(numberedCommits(100));
    await chooseStyle(user, style);

    const rendered = await screen.findAllByRole("listitem");
    expect(rendered.length).toBeLessThan(40);
    expect(rendered[0]).toHaveTextContent("Commit 0");

    await scrollHistory({ top: rowHeight * 50 });

    expect(await screen.findByText("Commit 49")).toBeInTheDocument();
    expect(screen.queryByText("Commit 0")).not.toBeInTheDocument();
  });

  it("asks for the next page only once the end is near", async () => {
    const requested: number[] = [];
    const user = await showHistory(numberedCommits(250), recordingPageRequests(requested));
    await chooseStyle(user, style);
    await screen.findAllByRole("listitem");

    expect(requested).toEqual([0]);

    await scrollHistory({ top: rowHeight * 95 });

    expect(await screen.findByText("Commit 100")).toBeInTheDocument();
    expect(requested).toEqual([0, 100]);
  });
});

describe("linear graph style", () => {
  it("puts every dot on one line, without branch lines", async () => {
    const user = await showHistory(branchingHistory);
    await chooseStyle(user, "Linear");

    const [merge, feature] = await screen.findAllByRole("listitem");
    expect(feature!.querySelector("[data-node]")).toHaveAttribute("data-lane", "0");
    expect(merge!.querySelector("[data-node]")).toHaveAttribute("data-merge");
    expect(feature!.querySelectorAll('[data-edge="through"]')).toHaveLength(1);
    expect(feature!.querySelectorAll('[data-edge="incoming"], [data-edge="outgoing"]')).toHaveLength(0);
  });

  it("starts the line at the newest commit and ends it at the oldest", async () => {
    const user = await showHistory(branchingHistory);
    await chooseStyle(user, "Linear");

    const [newest, , oldest] = await screen.findAllByRole("listitem");
    expect(newest!.querySelectorAll("[data-edge]")).toHaveLength(1);
    expect(newest!.querySelector("[data-edge]")).toHaveAttribute("data-edge", "outgoing");
    expect(oldest!.querySelector("[data-edge]")).toHaveAttribute("data-edge", "incoming");
  });

  it("keeps the line unbroken through a day heading", async () => {
    const user = await showHistory(branchingHistory);
    await chooseStyle(user, "Linear");

    const headings = await screen.findAllByRole("heading", { level: 2 });
    expect(headings[0]!.parentElement!.querySelectorAll("[data-edge]")).toHaveLength(0);
    expect(headings[1]!.parentElement!.querySelectorAll('[data-edge="through"]')).toHaveLength(1);
  });
});
