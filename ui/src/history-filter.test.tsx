import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { CoreApi, HistoryFilter, HistoryRow } from "./core/api";
import { createStubCoreApi } from "./core/stub";
import { commitRow, renderApp, sampleTab } from "./test-support";

const worktree = sampleTab.worktreePath;

const commits: HistoryRow[] = [
  commitRow({ id: "a".repeat(40), subject: "Merge feature", authorName: "Ada Lovelace" }),
  commitRow({ id: "b".repeat(40), subject: "Fix the lexer", authorName: "Grace Hopper" }),
  commitRow({ id: "c".repeat(40), subject: "Fix the parser", authorName: "Ada Lovelace" }),
  commitRow({ id: "d".repeat(40), subject: "Add the parser", authorName: "Ada Lovelace" }),
];

/**
 * A core that applies a made-up version of the filter and records what it was asked for: bare
 * text is a subject search, Mine is Ada's commits, Merges is the commits named "Merge …" and
 * a query starting with `bad:` is malformed.
 */
function filteringApi(sent: HistoryFilter[]): CoreApi {
  const matching = (filter: HistoryFilter) => {
    if (filter.query.startsWith("bad:")) {
      throw { kind: "invalidQuery", message: "Unknown key `bad:`", start: 0, end: 4 };
    }
    return commits.filter(
      (row) =>
        row.subject.toLowerCase().includes(filter.query.toLowerCase()) &&
        (!filter.mine || row.authorName === "Ada Lovelace") &&
        (!filter.merges || row.subject.startsWith("Merge")),
    );
  };
  const stub = createStubCoreApi({ [worktree]: sampleTab }, {}, { [worktree]: commits });
  return {
    ...stub,
    async historyPage(_path, offset, limit, filter) {
      sent.push(filter);
      const rows = matching(filter);
      return { offset, rows: rows.slice(offset, offset + limit), hasMore: rows.length > offset + limit };
    },
    async historyCount(_path, filter) {
      return { matching: matching(filter).length, total: commits.length };
    },
  };
}

async function showHistory(api: CoreApi) {
  const user = userEvent.setup();
  renderApp({ api, pickFolder: async () => worktree });
  await user.click(screen.getByRole("button", { name: /open folder/i }));
  await screen.findByRole("tab");
  await user.click(screen.getByRole("button", { name: "History" }));
  await screen.findAllByRole("listitem");
  return user;
}

function shownSubjects(): string[] {
  const list = screen.queryByRole("list", { name: "Commit history" });
  if (!list) return [];
  return within(list)
    .getAllByRole("listitem")
    .map((item) => item.querySelector(".commit-subject")!.textContent!);
}

function filterBox() {
  return screen.getByRole("searchbox", { name: "Filter commits" });
}

it("shows how many commits match out of all of them", async () => {
  await showHistory(filteringApi([]));

  expect(await screen.findByText("4 of 4 commits")).toBeInTheDocument();
});

it("sends the typed query to the core and shows the matching commits and their count", async () => {
  const sent: HistoryFilter[] = [];
  const user = await showHistory(filteringApi(sent));

  await user.type(filterBox(), "parser");

  expect(await screen.findByText("2 of 4 commits")).toBeInTheDocument();
  await screen.findByText("Fix the parser");
  expect(shownSubjects()).toEqual(["Fix the parser", "Add the parser"]);
  expect(sent.at(-1)).toEqual({ query: "parser", allBranches: true, mine: false, merges: false });
});

it("waits for a pause in typing before asking the core", async () => {
  const sent: HistoryFilter[] = [];
  const user = await showHistory(filteringApi(sent));
  const before = sent.length;

  await user.type(filterBox(), "parser");
  await screen.findByText("2 of 4 commits");

  expect(sent.slice(before).map((filter) => filter.query)).toEqual(["parser"]);
});

it("starts with All branches on and the other chips off", async () => {
  await showHistory(filteringApi([]));

  expect(screen.getByRole("button", { name: "All branches" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: "Mine" })).toHaveAttribute("aria-pressed", "false");
  expect(screen.getByRole("button", { name: "Merges" })).toHaveAttribute("aria-pressed", "false");
});

it("filters by each chip on its own", async () => {
  const sent: HistoryFilter[] = [];
  const user = await showHistory(filteringApi(sent));

  await user.click(screen.getByRole("button", { name: "Mine" }));
  expect(await screen.findByText("3 of 4 commits")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Mine" })).toHaveAttribute("aria-pressed", "true");
  expect(sent.at(-1)).toEqual({ query: "", allBranches: true, mine: true, merges: false });

  await user.click(screen.getByRole("button", { name: "Mine" }));
  await user.click(screen.getByRole("button", { name: "Merges" }));
  expect(await screen.findByText("1 of 4 commits")).toBeInTheDocument();
  expect(sent.at(-1)).toEqual({ query: "", allBranches: true, mine: false, merges: true });

  await user.click(screen.getByRole("button", { name: "Merges" }));
  await user.click(screen.getByRole("button", { name: "All branches" }));
  await screen.findByRole("button", { name: "All branches", pressed: false });
  expect(sent.at(-1)).toEqual({ query: "", allBranches: false, mine: false, merges: false });
});

it("combines the chips with each other and with the typed query", async () => {
  const sent: HistoryFilter[] = [];
  const user = await showHistory(filteringApi(sent));

  await user.type(filterBox(), "fix");
  await user.click(screen.getByRole("button", { name: "Mine" }));
  await user.click(screen.getByRole("button", { name: "Merges" }));

  expect(await screen.findByText("0 of 4 commits")).toBeInTheDocument();
  expect(sent.at(-1)).toEqual({ query: "fix", allBranches: true, mine: true, merges: true });
});

it("says so when nothing matches the filter", async () => {
  const user = await showHistory(filteringApi([]));

  await user.type(filterBox(), "zzz");

  expect(await screen.findByText("No commits match this filter.")).toBeInTheDocument();
  expect(screen.getByText("0 of 4 commits")).toBeInTheDocument();
  expect(filterBox()).toBeInTheDocument();
});

it("explains a malformed query and keeps the commits that were showing", async () => {
  const user = await showHistory(filteringApi([]));

  await user.type(filterBox(), "bad:x");

  expect(await screen.findByRole("alert")).toHaveTextContent("Unknown key `bad:`");
  expect(shownSubjects()).toHaveLength(4);
});

it("clears the explanation once the query is fixed", async () => {
  const user = await showHistory(filteringApi([]));
  await user.type(filterBox(), "bad:x");
  await screen.findByRole("alert");

  await user.clear(filterBox());
  await user.type(filterBox(), "lexer");

  expect(await screen.findByText("1 of 4 commits")).toBeInTheDocument();
  await screen.findByText("Fix the lexer");
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("counts a single commit in the singular", async () => {
  const single = createStubCoreApi({ [worktree]: sampleTab }, {}, { [worktree]: [commits[0]!] });

  await showHistory(single);

  expect(await screen.findByText("1 of 1 commit")).toBeInTheDocument();
});
