import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { CoreApi, HistoryRow, Tab } from "./core/api";
import { createStubCoreApi } from "./core/stub";
import { CommandRegistry } from "./palette/registry";
import { commitRow, renderApp, sampleTab } from "./test-support";

const worktree = sampleTab.worktreePath;
const otherTab: Tab = {
  repositoryName: "other",
  worktreePath: "C:\\work\\other",
  head: { kind: "branch", name: "develop" },
};

const commits: HistoryRow[] = [
  commitRow({ id: "a1b2c3d4".padEnd(40, "0"), subject: "Fix the lexer" }),
  commitRow({ id: "e5f6a7b8".padEnd(40, "0"), subject: "Add the parser" }),
];

function stubWithHistory() {
  return createStubCoreApi({ [worktree]: sampleTab }, {}, { [worktree]: commits });
}

async function openApp(api: CoreApi = stubWithHistory(), folders = [worktree]) {
  const user = userEvent.setup();
  const queue = [...folders];
  renderApp({ api, pickFolder: async () => queue.shift() ?? null });
  for (let opened = 1; opened <= folders.length; opened++) {
    await user.click(screen.getByRole("button", { name: /open folder/i }));
    await vi.waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(opened));
  }
  return user;
}

async function openPalette(user: ReturnType<typeof userEvent.setup>) {
  await user.keyboard("{Control>}p{/Control}");
  return screen.findByRole("combobox", { name: "Search or run" });
}

function listed() {
  return screen.queryAllByRole("option").map((option) => option.textContent ?? "");
}

function listing() {
  return listed().join("|");
}

function filterBox() {
  return screen.getByRole("searchbox", { name: "Filter commits" });
}

it("opens with Ctrl+P, focuses the input and closes with Escape", async () => {
  const user = userEvent.setup();
  renderApp();

  const input = await openPalette(user);

  expect(screen.getByRole("dialog", { name: "Command palette" })).toBeInTheDocument();
  expect(input).toHaveFocus();
  expect(input).toHaveAttribute("placeholder", "Search or run…");

  await user.keyboard("{Escape}");

  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("opens from the title bar", async () => {
  const user = userEvent.setup();
  renderApp();

  await user.click(screen.getByRole("button", { name: /search or run/i }));

  expect(await screen.findByRole("dialog", { name: "Command palette" })).toBeInTheDocument();
});

it("lists only the commands that apply to the current state", async () => {
  const user = userEvent.setup();
  renderApp();

  await openPalette(user);

  expect(listing()).toContain("Open folder…");
  expect(listing()).toContain("Go to History");
  expect(listing()).not.toContain("Go to Home");
  expect(listing()).not.toContain("only my commits");
  expect(listing()).not.toContain("Go to Tab");
});

it("offers the commands of the History view while History is on show", async () => {
  const user = await openApp();
  await openPalette(user);
  expect(listing()).not.toContain("Show only my commits");
  await user.keyboard("{Escape}");

  await user.click(screen.getByRole("button", { name: "History" }));
  await openPalette(user);

  expect(listing()).toContain("Show only my commits");
});

it("finds a command by fuzzy matching and runs it with Enter", async () => {
  const user = userEvent.setup();
  const pickFolder = vi.fn(async () => null);
  renderApp({ pickFolder });

  const input = await openPalette(user);
  await user.type(input, "opfo");

  expect(listed()[0]).toContain("Open folder…");

  await user.keyboard("{Enter}");

  expect(pickFolder).toHaveBeenCalledOnce();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("is operated with the keyboard alone", async () => {
  const user = userEvent.setup();
  renderApp();

  const input = await openPalette(user);
  await user.type(input, "go to");
  const first = screen.getAllByRole("option")[0]!;
  expect(first).toHaveAttribute("aria-selected", "true");
  expect(input).toHaveAttribute("aria-activedescendant", first.id);

  await user.keyboard("{ArrowDown}{ArrowDown}");
  const third = screen.getAllByRole("option")[2]!;
  expect(third).toHaveAttribute("aria-selected", "true");
  const destination = third.textContent!.replace(/^Navigate/, "").replace("Go to ", "");

  await user.keyboard("{Enter}");

  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(destination);
});

it("wraps the selection from the first result to the last with ArrowUp", async () => {
  const user = userEvent.setup();
  renderApp();

  await openPalette(user);
  await user.keyboard("{ArrowUp}");

  expect(screen.getAllByRole("option").at(-1)).toHaveAttribute("aria-selected", "true");
});

it("switches to another Tab", async () => {
  const api = createStubCoreApi({ [worktree]: sampleTab, [otherTab.worktreePath]: otherTab });
  const user = await openApp(api, [worktree, otherTab.worktreePath]);
  expect(screen.getByRole("tab", { name: /other/ })).toHaveAttribute("aria-selected", "true");

  const input = await openPalette(user);
  await user.type(input, "sample");
  await user.click(screen.getByRole("option", { name: /Go to Tab sample · main/ }));

  expect(screen.getByRole("tab", { name: /sample/ })).toHaveAttribute("aria-selected", "true");
});

it("toggles a History filter chip", async () => {
  const user = await openApp();
  await user.click(screen.getByRole("button", { name: "History" }));

  const input = await openPalette(user);
  await user.type(input, "my commits");
  await user.keyboard("{Enter}");

  expect(screen.getByRole("button", { name: "Mine" })).toHaveAttribute("aria-pressed", "true");

  await openPalette(user);
  expect(listing()).toContain("Show everyone's commits");
  expect(listing()).toContain("Clear the History filter");
});

it("jumps to a branch of the Repository as a History filter", async () => {
  const api = stubWithHistory();
  api.setBranches(worktree, [
    { kind: "localBranch", name: "main" },
    { kind: "localBranch", name: "feature" },
  ]);
  const user = await openApp(api);

  const input = await openPalette(user);
  await user.type(input, "feature");
  await user.click(await screen.findByRole("option", { name: /Show branch feature/ }));

  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("History");
  expect(filterBox()).toHaveValue("branch:feature");
});

it("treats text that is not a command as a commit search by message", async () => {
  const user = await openApp();

  const input = await openPalette(user);
  await user.type(input, "parser");

  const hit = await screen.findByRole("option", { name: /Add the parser/ });
  expect(hit).toHaveTextContent("e5f6a7b");
  expect(listed().at(-1)).toContain("Search commits for “parser”");

  await user.click(hit);

  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("History");
  expect(filterBox()).toHaveValue('"Add the parser"');
});

it("finds a commit by the start of its hash", async () => {
  const user = await openApp();

  const input = await openPalette(user);
  await user.type(input, "a1b2c3");

  expect(await screen.findByRole("option", { name: /Fix the lexer/ })).toBeInTheDocument();
  expect(screen.queryByRole("option", { name: /Add the parser/ })).not.toBeInTheDocument();
});

it("runs the commit search with Enter when no command matches", async () => {
  const user = await openApp();

  const input = await openPalette(user);
  await user.type(input, "zzqx");
  await screen.findByRole("option", { name: /Search commits for/ });
  await user.keyboard("{Enter}");

  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("History");
  expect(filterBox()).toHaveValue("zzqx");
});

it("explains a query the core refuses", async () => {
  const api: CoreApi = {
    ...stubWithHistory(),
    async findCommits() {
      throw { kind: "invalidQuery", message: "`author:` needs a value", start: 0, end: 7 };
    },
  };
  const user = await openApp(api);

  const input = await openPalette(user);
  await user.type(input, "author:");

  expect(await screen.findByRole("alert")).toHaveTextContent("`author:` needs a value");
});

it("does not offer a commit search without a Tab", async () => {
  const user = userEvent.setup();
  renderApp();

  const input = await openPalette(user);
  await user.type(input, "zzqx");

  expect(screen.queryByRole("option", { name: /Search commits/ })).not.toBeInTheDocument();
  expect(screen.getByText(/Open a folder to search its commits/)).toBeInTheDocument();
});

it("shows a command's failure as the app error", async () => {
  const user = userEvent.setup();
  const appWindow = {
    minimize: vi.fn(async () => {
      throw new Error("no window");
    }),
    toggleMaximize: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
  };
  renderApp({ appWindow });

  const input = await openPalette(user);
  await user.type(input, "minimize");
  await user.keyboard("{Enter}");

  expect(await screen.findByRole("alert")).toHaveTextContent("no window");
});

describe("the command registry", () => {
  const command = (id: string) => ({ id, title: id, group: "Test", run: () => {} });

  it("lists registered commands until they are withdrawn", () => {
    const registry = new CommandRegistry();
    const withdraw = registry.register([command("a.one"), command("a.two")]);
    expect(registry.getSnapshot().map(({ id }) => id)).toEqual(["a.one", "a.two"]);

    withdraw();

    expect(registry.getSnapshot()).toEqual([]);
  });

  it("refuses an id that is already taken and registers nothing from that call", () => {
    const registry = new CommandRegistry();
    registry.register([command("a.one")]);

    expect(() => registry.register([command("b.one"), command("a.one")])).toThrow(/a\.one/);
    expect(registry.getSnapshot().map(({ id }) => id)).toEqual(["a.one"]);
  });
});
