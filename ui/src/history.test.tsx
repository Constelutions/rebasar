import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { CoreApi, HistoryRow } from "./core/api";
import {
  commitRow,
  localTime,
  numberedCommits,
  renderApp,
  scrollHistory,
  showHistory,
} from "./test-support";

const rowHeight = 36;

function recordingPageRequests(requested: number[]) {
  return (api: CoreApi): CoreApi => ({
    ...api,
    historyPage: (path, offset, limit) => {
      requested.push(offset);
      return api.historyPage(path, offset, limit);
    },
  });
}

it("asks for a folder when no Worktree is open", async () => {
  const user = userEvent.setup();
  renderApp();

  await user.click(screen.getByRole("button", { name: "History" }));

  expect(screen.getByRole("main")).toHaveTextContent("Open a folder to see its history");
});

it("lists each commit with its message, author and short hash", async () => {
  await showHistory([
    commitRow({ id: "a".repeat(40), subject: "Add the parser", authorName: "Ada Lovelace" }),
    commitRow({ id: "b".repeat(40), subject: "Fix the lexer", authorName: "Grace Hopper" }),
  ]);

  const commits = within(await screen.findByRole("list", { name: "Commit history" })).getAllByRole(
    "listitem",
  );
  expect(commits).toHaveLength(2);
  expect(commits[0]).toHaveTextContent("Add the parser");
  expect(commits[0]).toHaveTextContent("Ada Lovelace");
  expect(commits[0]).toHaveTextContent("aaaaaaa");
  expect(commits[1]).toHaveTextContent("Fix the lexer");
});

it("shows the author's initials as an avatar", async () => {
  await showHistory([commitRow({ authorName: "Ada Lovelace", authorEmail: "ada@example.com" })]);

  expect(await screen.findByTitle("Ada Lovelace <ada@example.com>")).toHaveTextContent("AL");
});

it("labels commits with HEAD, local and remote branches and tags", async () => {
  await showHistory([
    commitRow({
      refs: [
        { kind: "head", name: "HEAD" },
        { kind: "localBranch", name: "main" },
        { kind: "remoteBranch", name: "origin/main" },
        { kind: "tag", name: "v1.0" },
      ],
    }),
  ]);

  const commit = await screen.findByRole("listitem");
  for (const name of ["HEAD", "main", "origin/main", "v1.0"]) {
    expect(within(commit).getByText(name)).toBeInTheDocument();
  }
});

it("groups commits under a heading for the day they were made", async () => {
  await showHistory([
    commitRow({ id: "a".repeat(40), subject: "Tuesday morning", timestamp: localTime(2026, 1, 6, 9) }),
    commitRow({ id: "b".repeat(40), subject: "Monday evening", timestamp: localTime(2026, 1, 5, 20) }),
    commitRow({ id: "c".repeat(40), subject: "Monday morning", timestamp: localTime(2026, 1, 5, 8) }),
  ]);

  const headings = await screen.findAllByRole("heading", { level: 2 });
  expect(headings.map((heading) => heading.textContent)).toEqual([
    "Tuesday, January 6, 2026",
    "Monday, January 5, 2026",
  ]);
  const commits = screen.getAllByRole("listitem");
  expect(commits).toHaveLength(3);
  expect(commits[0]).toHaveTextContent("Tuesday morning");
  expect(commits[2]).toHaveTextContent("Monday morning");
});

it("draws a line for each edge and marks a merge commit's dot", async () => {
  await showHistory([
    commitRow({
      subject: "Merge feature",
      lane: 0,
      laneCount: 2,
      edges: [
        { kind: "outgoing", lane: 0 },
        { kind: "outgoing", lane: 1 },
      ],
    }),
    commitRow({
      id: "b".repeat(40),
      subject: "Feature work",
      lane: 1,
      laneCount: 2,
      edges: [
        { kind: "through", lane: 0 },
        { kind: "incoming", lane: 1 },
        { kind: "outgoing", lane: 1 },
      ],
    }),
  ]);

  const [merge, feature] = await screen.findAllByRole("listitem");
  expect(merge!.querySelectorAll('[data-edge="outgoing"]')).toHaveLength(2);
  expect(merge!.querySelector("[data-node]")).toHaveAttribute("data-merge");
  expect(feature!.querySelector("[data-node]")).toHaveAttribute("data-lane", "1");
  expect(feature!.querySelector("[data-node]")).not.toHaveAttribute("data-merge");
  expect(feature!.querySelectorAll("[data-edge]")).toHaveLength(3);
});

it("keeps lines running through the day heading between two commits", async () => {
  await showHistory([
    commitRow({
      id: "a".repeat(40),
      timestamp: localTime(2026, 1, 6, 9),
      lane: 0,
      laneCount: 2,
      edges: [
        { kind: "outgoing", lane: 0 },
        { kind: "outgoing", lane: 1 },
      ],
    }),
    commitRow({ id: "b".repeat(40), timestamp: localTime(2026, 1, 5, 9) }),
  ]);

  const second = (await screen.findAllByRole("heading", { level: 2 }))[1]!;
  const lanes = [...second.parentElement!.querySelectorAll('[data-edge="through"]')].map((line) =>
    line.getAttribute("data-lane"),
  );
  expect(lanes).toEqual(["0", "1"]);
});

it("says so when the history has no commits", async () => {
  await showHistory([]);

  expect(await screen.findByText("No commits yet.")).toBeInTheDocument();
});

it("explains why the history could not be read", async () => {
  await showHistory([], (api) => ({
    ...api,
    historyPage: async () => {
      throw { kind: "unexpected", message: "the object database is damaged" };
    },
  }));

  expect(await screen.findByRole("alert")).toHaveTextContent("the object database is damaged");
});

it("renders only the rows around the viewport of a long history", async () => {
  await showHistory(numberedCommits(100));

  const rendered = await screen.findAllByRole("listitem");

  expect(rendered.length).toBeGreaterThan(5);
  expect(rendered.length).toBeLessThan(40);
  expect(rendered[0]).toHaveTextContent("Commit 0");
});

it("renders the rows that are scrolled into view", async () => {
  await showHistory(numberedCommits(100));
  await screen.findAllByRole("listitem");

  await scrollHistory({ top: rowHeight * 50 });

  expect(await screen.findByText("Commit 49")).toBeInTheDocument();
  expect(screen.queryByText("Commit 0")).not.toBeInTheDocument();
});

it("loads only the first page until the user scrolls towards the end", async () => {
  const requested: number[] = [];
  await showHistory(numberedCommits(250), recordingPageRequests(requested));
  await screen.findAllByRole("listitem");

  expect(requested).toEqual([0]);

  await scrollHistory({ top: rowHeight * 90 });

  expect(await screen.findByText("Commit 100")).toBeInTheDocument();
  expect(requested).toEqual([0, 100]);
});

it("keeps loading pages until the whole history has been shown", async () => {
  const requested: number[] = [];
  await showHistory(numberedCommits(250), recordingPageRequests(requested));
  await screen.findAllByRole("listitem");

  for (const top of [rowHeight * 90, rowHeight * 190, rowHeight * 250]) {
    await scrollHistory({ top });
  }

  expect(requested).toEqual([0, 100, 200]);
  expect(await screen.findByText("Commit 249")).toBeInTheDocument();
});
