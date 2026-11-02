import { cleanup, screen, waitFor, within } from "@testing-library/react";

import { type CoreApi, type HistoryRow, type Settings, defaultSettings } from "./core/api";
import {
  commitRow,
  localTime,
  numberedCommits,
  scrollHistory,
  showHistory,
} from "./test-support";

const columnWidth = 220;

const layouts = [
  { orientation: "Vertical", style: "Tree" },
  { orientation: "Vertical", style: "Linear" },
  { orientation: "Horizontal", style: "Tree" },
] as const;

type Layout = (typeof layouts)[number];

async function chooseLayout(user: Awaited<ReturnType<typeof showHistory>>, layout: Layout) {
  await user.click(screen.getByRole("radio", { name: layout.orientation }));
  await user.click(screen.getByRole("radio", { name: layout.style }));
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

it("offers vertical and tree by default", async () => {
  await showHistory(branchingHistory);

  expect(screen.getByRole("radio", { name: "Vertical" })).toBeChecked();
  expect(screen.getByRole("radio", { name: "Tree" })).toBeChecked();
  expect(screen.getByRole("radio", { name: "Horizontal" })).not.toBeChecked();
  expect(screen.getByRole("radio", { name: "Linear" })).not.toBeChecked();
});

it("keeps the chosen orientation and graph style the next time History is shown", async () => {
  let api!: CoreApi;
  const user = await showHistory(branchingHistory, (stub) => (api = stub));
  await chooseLayout(user, { orientation: "Vertical", style: "Linear" });

  cleanup();
  await showHistory(branchingHistory, () => api);

  expect(screen.getByRole("radio", { name: "Vertical" })).toBeChecked();
  expect(screen.getByRole("radio", { name: "Linear" })).toBeChecked();
});

it("stores the chosen orientation and graph style in the settings", async () => {
  let api!: CoreApi;
  const user = await showHistory(branchingHistory, (stub) => (api = stub));

  await user.click(screen.getByRole("radio", { name: "Horizontal" }));

  await waitFor(async () =>
    expect((await api.settings()).history).toMatchObject({ orientation: "horizontal", graphStyle: "tree" }),
  );
});

it("opens with the orientation and graph style the settings ask for", async () => {
  await showHistory(branchingHistory, withHistorySettings({ orientation: "horizontal", graphStyle: "tree" }));

  expect(screen.getByRole("radio", { name: "Horizontal" })).toBeChecked();
  expect(screen.getByRole("radio", { name: "Tree" })).toBeChecked();
});

describe("Horizontal and Linear together", () => {
  it("cannot be chosen while Horizontal is selected", async () => {
    const user = await showHistory(branchingHistory);
    await user.click(screen.getByRole("radio", { name: "Horizontal" }));

    expect(screen.getByRole("radio", { name: "Linear" })).toBeDisabled();
    expect(screen.getByRole("radio", { name: "Tree" })).toBeEnabled();
  });

  it("can be chosen again once Vertical is selected", async () => {
    const user = await showHistory(branchingHistory);
    await user.click(screen.getByRole("radio", { name: "Horizontal" }));
    await user.click(screen.getByRole("radio", { name: "Vertical" }));

    expect(screen.getByRole("radio", { name: "Linear" })).toBeEnabled();
  });

  it("switch the graph to Tree when Horizontal is chosen from Linear", async () => {
    const user = await showHistory(branchingHistory);
    await user.click(screen.getByRole("radio", { name: "Linear" }));

    await user.click(screen.getByRole("radio", { name: "Horizontal" }));

    expect(screen.getByRole("radio", { name: "Horizontal" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Tree" })).toBeChecked();
  });

  it("are shown as Horizontal and Tree when the settings hold them", async () => {
    await showHistory(branchingHistory, withHistorySettings({ orientation: "horizontal", graphStyle: "linear" }));

    expect(screen.getByRole("radio", { name: "Horizontal" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Tree" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Linear" })).toBeDisabled();
  });
});

describe("a layout stored by an earlier version", () => {
  function store(layout: { orientation: string; style: string }) {
    localStorage.setItem("rebasar.history.layout", JSON.stringify(layout));
  }

  it("becomes Horizontal and Tree when it was Horizontal and Linear", async () => {
    store({ orientation: "horizontal", style: "linear" });
    let api!: CoreApi;

    await showHistory(branchingHistory, (stub) => (api = stub));

    expect(screen.getByRole("radio", { name: "Horizontal" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Tree" })).toBeChecked();
    await waitFor(async () =>
      expect((await api.settings()).history).toMatchObject({ orientation: "horizontal", graphStyle: "tree" }),
    );
  });

  it("is carried into the settings and then forgotten", async () => {
    store({ orientation: "vertical", style: "linear" });
    let api!: CoreApi;

    await showHistory(branchingHistory, (stub) => (api = stub));

    expect(screen.getByRole("radio", { name: "Linear" })).toBeChecked();
    await waitFor(async () =>
      expect((await api.settings()).history).toMatchObject({ orientation: "vertical", graphStyle: "linear" }),
    );
    expect(localStorage.getItem("rebasar.history.layout")).toBeNull();
  });
});

describe.each(layouts)("$orientation $style", (layout) => {
  it("shows each commit with its message, author, hash, labels and day heading", async () => {
    const user = await showHistory(branchingHistory);
    await chooseLayout(user, layout);

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
    await chooseLayout(user, layout);
    const scrollAxis = layout.orientation === "Vertical" ? "top" : "left";
    const itemSize = layout.orientation === "Vertical" ? 36 : columnWidth;

    const rendered = await screen.findAllByRole("listitem");
    expect(rendered.length).toBeLessThan(40);
    expect(rendered[0]).toHaveTextContent("Commit 0");

    await scrollHistory({ [scrollAxis]: itemSize * 50 });

    expect(await screen.findByText("Commit 49")).toBeInTheDocument();
    expect(screen.queryByText("Commit 0")).not.toBeInTheDocument();
  });

  it("asks for the next page only once the end is near", async () => {
    const requested: number[] = [];
    const user = await showHistory(numberedCommits(250), recordingPageRequests(requested));
    await chooseLayout(user, layout);
    await screen.findAllByRole("listitem");
    const scrollAxis = layout.orientation === "Vertical" ? "top" : "left";
    const itemSize = layout.orientation === "Vertical" ? 36 : columnWidth;

    expect(requested).toEqual([0]);

    await scrollHistory({ [scrollAxis]: itemSize * 95 });

    expect(await screen.findByText("Commit 100")).toBeInTheDocument();
    expect(requested).toEqual([0, 100]);
  });
});

describe("linear graph style", () => {
  it("puts every dot on one line, without branch lines", async () => {
    const user = await showHistory(branchingHistory);
    await chooseLayout(user, { orientation: "Vertical", style: "Linear" });

    const [merge, feature] = await screen.findAllByRole("listitem");
    expect(feature!.querySelector("[data-node]")).toHaveAttribute("data-lane", "0");
    expect(merge!.querySelector("[data-node]")).toHaveAttribute("data-merge");
    expect(feature!.querySelectorAll('[data-edge="through"]')).toHaveLength(1);
    expect(feature!.querySelectorAll('[data-edge="incoming"], [data-edge="outgoing"]')).toHaveLength(0);
  });

  it("starts the line at the newest commit and ends it at the oldest", async () => {
    const user = await showHistory(branchingHistory);
    await chooseLayout(user, { orientation: "Vertical", style: "Linear" });

    const [newest, , oldest] = await screen.findAllByRole("listitem");
    expect(newest!.querySelectorAll("[data-edge]")).toHaveLength(1);
    expect(newest!.querySelector("[data-edge]")).toHaveAttribute("data-edge", "outgoing");
    expect(oldest!.querySelector("[data-edge]")).toHaveAttribute("data-edge", "incoming");
  });

  it("keeps the line unbroken through a day heading", async () => {
    const user = await showHistory(branchingHistory);
    await chooseLayout(user, { orientation: "Vertical", style: "Linear" });

    const headings = await screen.findAllByRole("heading", { level: 2 });
    expect(headings[0]!.parentElement!.querySelectorAll("[data-edge]")).toHaveLength(0);
    expect(headings[1]!.parentElement!.querySelectorAll('[data-edge="through"]')).toHaveLength(1);
  });
});

describe("horizontal orientation", () => {
  it("lays commits out left to right with the lanes stacked top to bottom", async () => {
    const user = await showHistory(branchingHistory);
    await chooseLayout(user, { orientation: "Horizontal", style: "Tree" });

    const [merge, feature] = await screen.findAllByRole("listitem");
    const node = feature!.querySelector("[data-node]")!;
    expect(node).toHaveAttribute("cy", "36");
    expect(Number(node.getAttribute("cx"))).toBeGreaterThan(0);
    expect(feature!.querySelectorAll("[data-edge]")).toHaveLength(3);
    expect(merge!.querySelectorAll('[data-edge="outgoing"]')).toHaveLength(2);
    expect(merge!.compareDocumentPosition(feature!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  describe("with many branches", () => {
    const laneCount = 20;
    const parallelHistory = [
      commitRow({
        id: "a".repeat(40),
        subject: "Tip of the last branch",
        lane: laneCount - 1,
        laneCount,
        edges: [{ kind: "outgoing", lane: laneCount - 1 }],
      }),
    ];

    it("gives every branch its own lane instead of clipping the ones past the twelfth", async () => {
      const user = await showHistory(parallelHistory);
      await user.click(screen.getByRole("radio", { name: "Horizontal" }));

      const [commit] = await screen.findAllByRole("listitem");
      const lanes = commit!.querySelector("svg")!;
      const node = commit!.querySelector("[data-node]")!;
      expect(Number(lanes.getAttribute("height"))).toBeGreaterThan(Number(node.getAttribute("cy")));
      expect(Number(lanes.getAttribute("height"))).toBeGreaterThanOrEqual(laneCount * 24);
    });

    it("makes the list taller than its lanes so the view scrolls vertically", async () => {
      const user = await showHistory(parallelHistory);
      await user.click(screen.getByRole("radio", { name: "Horizontal" }));

      const list = await screen.findByRole("list", { name: "Commit history" });
      expect(Number.parseFloat(list.style.minHeight)).toBeGreaterThan(laneCount * 24);
    });
  });
});
