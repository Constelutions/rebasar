import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { type CoreApi, type HistoryFilter, type HistoryRow, type Settings, defaultSettings } from "./core/api";
import { createStubCoreApi } from "./core/stub";
import { commitRow, renderApp, sampleTab } from "./test-support";

const worktree = sampleTab.worktreePath;

const commits: HistoryRow[] = [
  commitRow({ id: "a".repeat(40), subject: "Merge feature", authorName: "Ada Lovelace" }),
  commitRow({ id: "b".repeat(40), subject: "Fix the lexer", authorName: "Grace Hopper" }),
  commitRow({ id: "c".repeat(40), subject: "Fix the parser", authorName: "Ada Lovelace" }),
  commitRow({ id: "d".repeat(40), subject: "Add the parser", authorName: "Ada Lovelace" }),
];

const me = "Ada Lovelace";
const authorTerm = /author:("[^"]*"|\S+)/g;

/**
 * A core that applies a made-up version of the filter and records what it was asked for: bare
 * text is a subject search, `author:` terms name who may have written the commit (`@me` is Ada),
 * Merges is the commits named "Merge …" and a query starting with `bad:` is malformed.
 */
function filteringApi(sent: HistoryFilter[], settings?: Settings): CoreApi {
  const matching = (filter: HistoryFilter) => {
    if (filter.query.startsWith("bad:")) {
      throw { kind: "invalidQuery", message: "Unknown key `bad:`", start: 0, end: 4 };
    }
    const authors = [...filter.query.matchAll(authorTerm)].map(([, name]) =>
      name!.replaceAll('"', "").replace("@me", me),
    );
    const text = filter.query.replace(authorTerm, "").trim().toLowerCase();
    return commits.filter(
      (row) =>
        row.subject.toLowerCase().includes(text) &&
        (authors.length === 0 || authors.includes(row.authorName)) &&
        (!filter.merges || row.subject.startsWith("Merge")),
    );
  };
  const stub = createStubCoreApi({ [worktree]: sampleTab }, {}, { [worktree]: commits }, {}, {}, undefined, {
    settings,
  });
  stub.setBranches(worktree, [
    { kind: "localBranch", name: "main" },
    { kind: "localBranch", name: "feature" },
    { kind: "remoteBranch", name: "origin/main" },
  ]);
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

function trigger(name: "Branches" | "Authors") {
  return within(screen.getByRole("group", { name: "History filter" })).getByRole("button", {
    name: new RegExp(`^${name}`),
  });
}

type User = ReturnType<typeof userEvent.setup>;

/** Opens the select if it is closed and clicks the option; the presets are radios, the rest checkboxes. */
async function choose(user: User, name: "Branches" | "Authors", option: string) {
  const button = trigger(name);
  if (button.getAttribute("aria-expanded") !== "true") await user.click(button);
  const preset = ["All branches", "Current branch", "Everyone"].includes(option);
  await user.click(screen.getByRole(preset ? "radio" : "checkbox", { name: option }));
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
  expect(sent.at(-1)).toEqual({ query: "parser", allBranches: true, merges: false });
});

it("waits for a pause in typing before asking the core", async () => {
  const sent: HistoryFilter[] = [];
  const user = await showHistory(filteringApi(sent));
  const before = sent.length;

  await user.type(filterBox(), "parser");
  await screen.findByText("2 of 4 commits");

  expect(sent.slice(before).map((filter) => filter.query)).toEqual(["parser"]);
});

it("starts showing every branch and everyone, with Merges off", async () => {
  await showHistory(filteringApi([]));

  expect(trigger("Branches")).toHaveTextContent("All branches");
  expect(trigger("Authors")).toHaveTextContent("Everyone");
  expect(screen.getByRole("button", { name: "Merges" })).toHaveAttribute("aria-pressed", "false");
  expect(filterBox()).toHaveValue("");
});

it("writes the chosen authors into the query and shows the commits of any of them", async () => {
  const sent: HistoryFilter[] = [];
  const user = await showHistory(filteringApi(sent));

  await choose(user, "Authors", "Grace Hopper");
  expect(filterBox()).toHaveValue('author:"Grace Hopper"');
  expect(await screen.findByText("1 of 4 commits")).toBeInTheDocument();

  await choose(user, "Authors", "Ada Lovelace");
  expect(filterBox()).toHaveValue('author:"Grace Hopper" author:"Ada Lovelace"');
  expect(await screen.findByText("4 of 4 commits")).toBeInTheDocument();
  expect(sent.at(-1)).toEqual({
    query: 'author:"Grace Hopper" author:"Ada Lovelace"',
    allBranches: true,
    merges: false,
  });
  expect(trigger("Authors")).toHaveTextContent("Grace Hopper, Ada Lovelace");
});

it("stands for the Repository's Git identity with Me, next to other authors", async () => {
  const user = await showHistory(filteringApi([]));

  await choose(user, "Authors", "Me");

  expect(filterBox()).toHaveValue("author:@me");
  expect(await screen.findByText("3 of 4 commits")).toBeInTheDocument();
  expect(trigger("Authors")).toHaveTextContent("Me");

  await choose(user, "Authors", "Grace Hopper");
  expect(filterBox()).toHaveValue('author:@me author:"Grace Hopper"');
  expect(await screen.findByText("4 of 4 commits")).toBeInTheDocument();
});

it("removes only that author's term when it is unchecked, and Everyone removes them all", async () => {
  const user = await showHistory(filteringApi([]));
  await user.type(filterBox(), "fix author:@me");
  await choose(user, "Authors", "Grace Hopper");

  await choose(user, "Authors", "Me");
  expect(filterBox()).toHaveValue('fix author:"Grace Hopper"');

  await choose(user, "Authors", "Everyone");
  expect(filterBox()).toHaveValue("fix");
});

it("updates the selects when the query is edited by hand", async () => {
  const user = await showHistory(filteringApi([]));

  await user.type(filterBox(), 'author:@me author:"Grace Hopper" branch:feature');

  await user.click(trigger("Authors"));
  expect(screen.getByRole("checkbox", { name: "Me" })).toBeChecked();
  expect(screen.getByRole("checkbox", { name: "Grace Hopper" })).toBeChecked();
  expect(screen.getByRole("checkbox", { name: "Ada Lovelace" })).not.toBeChecked();
  expect(screen.getByRole("radio", { name: "Everyone" })).not.toBeChecked();
  await user.click(trigger("Branches"));
  expect(screen.getByRole("checkbox", { name: "feature" })).toBeChecked();
  expect(screen.getByRole("checkbox", { name: "main" })).not.toBeChecked();
  expect(trigger("Branches")).toHaveTextContent("feature");
});

it("lists an author typed by hand so it can be unchecked", async () => {
  const user = await showHistory(filteringApi([]));
  await user.type(filterBox(), "author:zed");

  await choose(user, "Authors", "zed");

  expect(filterBox()).toHaveValue("");
});

it("writes the chosen branches into the query", async () => {
  const user = await showHistory(filteringApi([]));

  await choose(user, "Branches", "feature");
  await choose(user, "Branches", "origin/main");

  expect(filterBox()).toHaveValue("branch:feature branch:origin/main");
  expect(trigger("Branches")).toHaveTextContent("feature, origin/main");

  await choose(user, "Branches", "main");
  expect(trigger("Branches")).toHaveTextContent("3 branches");
  await choose(user, "Branches", "main");

  await choose(user, "Branches", "All branches");
  expect(filterBox()).toHaveValue("");
  expect(trigger("Branches")).toHaveTextContent("All branches");
});

it("narrows History to the current branch from the Branches select", async () => {
  const sent: HistoryFilter[] = [];
  const user = await showHistory(filteringApi(sent));

  await choose(user, "Branches", "Current branch");

  await waitFor(() => expect(sent.at(-1)).toEqual({ query: "", allBranches: false, merges: false }));
  expect(trigger("Branches")).toHaveTextContent("Current branch");
});

it("filters by Merges on its own", async () => {
  const sent: HistoryFilter[] = [];
  const user = await showHistory(filteringApi(sent));

  await user.click(screen.getByRole("button", { name: "Merges" }));

  expect(await screen.findByText("1 of 4 commits")).toBeInTheDocument();
  expect(sent.at(-1)).toEqual({ query: "", allBranches: true, merges: true });
});

it("combines the selects with the Merges chip and the typed query", async () => {
  const sent: HistoryFilter[] = [];
  const user = await showHistory(filteringApi(sent));

  await user.type(filterBox(), "fix");
  await choose(user, "Authors", "Me");
  await user.click(screen.getByRole("button", { name: "Merges" }));

  expect(await screen.findByText("0 of 4 commits")).toBeInTheDocument();
  expect(sent.at(-1)).toEqual({ query: "fix author:@me", allBranches: true, merges: true });
});

it("starts with the filters the settings ask for", async () => {
  const settings: Settings = {
    ...defaultSettings,
    history: { ...defaultSettings.history, mine: true, merges: true, allBranches: false },
  };

  await showHistory(filteringApi([], settings));

  expect(filterBox()).toHaveValue("author:@me");
  expect(trigger("Authors")).toHaveTextContent("Me");
  expect(trigger("Branches")).toHaveTextContent("Current branch");
  expect(screen.getByRole("button", { name: "Merges" })).toHaveAttribute("aria-pressed", "true");
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
