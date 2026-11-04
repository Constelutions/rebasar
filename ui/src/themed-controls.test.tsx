import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { BranchInfo, WorktreeDetail } from "./core/api";
import { createStubCoreApi } from "./core/stub";
import { renderApp, sampleTab } from "./test-support";

const worktree = sampleTab.worktreePath;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx$/.test(name) && !/\.test\./.test(name) ? [path] : [];
  });
}

function stylesheet(name: string) {
  return readFileSync(join(__dirname, name), "utf-8");
}

/** The declarations of every rule whose selector list is exactly `selector`, or `null` when no such rule exists. */
function rule(css: string, selector: string): string | null {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = [...css.matchAll(new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`, "gm"))];
  return matches.length === 0 ? null : matches.map((match) => match[1]).join("\n");
}

/** The declarations of every rule whose selector list contains `selector`, or `null` when no rule does. */
function ruleFor(css: string, selector: string): string | null {
  const matches = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].filter((match) =>
    (match[1] ?? "").split(",").some((part) => part.trim() === selector),
  );
  return matches.length === 0 ? null : matches.map((match) => match[2]).join("\n");
}

describe("shared button", () => {
  it("is the only place a raw button element is written in the views", () => {
    const offenders = sourceFiles(__dirname)
      .filter((path) => !path.endsWith(join("components", "Button.tsx")))
      .filter((path) => readFileSync(path, "utf-8").includes("<button"));

    expect(offenders).toEqual([]);
  });

  it("styles the variants from the design tokens", () => {
    const css = stylesheet("styles.css");

    for (const selector of [".button", ".button-secondary", ".button-primary", ".button-danger", ".button-sm"]) {
      expect(rule(css, selector), selector).not.toBeNull();
    }
    expect(rule(css, ".button-primary")).toContain("var(--color-accent)");
    expect(rule(css, ".button-danger")).toContain("var(--color-danger-strong)");
  });
});

describe("shared input style", () => {
  /** Every `<tag ...` element in the views, up to its `/>` or its closing tag. */
  function openings(tag: string) {
    return sourceFiles(__dirname)
      .filter((path) => !path.endsWith(join("components", "FormControls.tsx")))
      .flatMap((path) => {
        const source = readFileSync(path, "utf-8");
        return [...source.matchAll(new RegExp(String.raw`<${tag}\b[\s\S]*?(?:/>|</${tag}>)`, "g"))].map((match) => ({
          path,
          opening: match[0],
        }));
      });
  }

  it("is the only place a raw text input, select or textarea is written in the views", () => {
    const offenders = [
      ...openings("input").filter(({ opening }) => !/type="(checkbox|radio)"/.test(opening)),
      ...openings("select"),
      ...openings("textarea"),
    ].map(({ path }) => path);

    expect([...new Set(offenders)]).toEqual([]);
  });

  it("styles focus, hover and disabled the same for inputs and selects", () => {
    const css = stylesheet("styles.css");

    for (const state of [":hover:not(:disabled)", ":focus-visible", ":disabled"]) {
      expect(ruleFor(css, `.text-input${state}`), state).not.toBeNull();
      expect(ruleFor(css, `.select${state}`), state).not.toBeNull();
    }
  });

  it("has no second style for search boxes", () => {
    const css = stylesheet("styles.css");

    expect(ruleFor(css, ".filter-input")).toBeNull();
    expect(ruleFor(css, ".filter-input:focus-visible")).toBeNull();
  });

  it("themes the inputs and selects of the Worktrees forms", async () => {
    const user = await open("Worktrees");
    await screen.findByRole("list", { name: "Worktrees" });

    expect(screen.getByLabelText("Folder")).toHaveClass("text-input");
    expect(screen.getByLabelText("Start from")).toHaveClass("select");
    expect(screen.getByLabelText("New branch (optional)")).toHaveClass("text-input");
    await user.selectOptions(screen.getByLabelText("Start from"), "A commit…");
    expect(screen.getByLabelText("Commit")).toHaveClass("text-input");
  });

  it("themes the new branch field and the search box on the Branches page", async () => {
    await open("Branches");

    expect(await screen.findByRole("textbox", { name: "New branch" })).toHaveClass("text-input");
    expect(screen.getByRole("searchbox", { name: "Search branches" })).toHaveClass("text-input");
  });

  it("themes the stash message field", async () => {
    await open("Stashes");

    expect(await screen.findByLabelText("Stash message")).toHaveClass("text-input");
  });

  it("themes the History search box", async () => {
    await open("History");

    expect(await screen.findByRole("searchbox", { name: "Filter commits" })).toHaveClass("text-input");
  });

  it("themes the commit message field of the composer", async () => {
    await open("Changes");

    expect(await screen.findByLabelText("Commit message")).toHaveClass("text-input");
  });
});

describe("themed scrollbars", () => {
  it("defines the scrollbar colours as tokens", () => {
    const tokens = stylesheet("tokens.css");

    expect(tokens).toMatch(/--color-scrollbar-thumb\s*:\s*oklch\(/);
    expect(tokens).toMatch(/--color-scrollbar-track\s*:/);
  });

  it("applies one scrollbar style to every scrolling region", () => {
    const declarations = rule(stylesheet("styles.css"), "*");

    expect(declarations).toContain("scrollbar-color: var(--color-scrollbar-thumb) var(--color-scrollbar-track)");
    expect(declarations).toContain("scrollbar-width: thin");
  });
});

describe("overflow", () => {
  it("keeps the controls beside the Tab strip at full size while only the Tab list scrolls", () => {
    const css = stylesheet("styles.css");

    expect(rule(css, ".tab-strip")).toContain("overflow-x: auto");
    expect(rule(css, ".tab-strip")).toContain("min-width: 0");
    expect(rule(css, ".open-folder")).toContain("flex: none");
    expect(rule(css, ".palette-trigger")).toContain("flex: none");
  });

  it.each([".branches", ".worktrees"])("scrolls %s vertically when its content overflows", (selector) => {
    const declarations = rule(stylesheet("styles.css"), selector);

    expect(declarations).toContain("overflow-y: auto");
    expect(declarations).toContain("min-height: 0");
  });
});

const main: WorktreeDetail = {
  path: worktree,
  main: true,
  head: { kind: "branch", name: "main" },
  dirty: false,
  current: true,
};

function branch(name: string, overrides: Partial<BranchInfo> = {}): BranchInfo {
  return {
    name,
    kind: "local",
    current: false,
    upstream: null,
    ahead: 0,
    behind: 0,
    merged: false,
    shortId: "abc1234",
    ...overrides,
  };
}

async function open(view: string) {
  const user = userEvent.setup();
  const api = createStubCoreApi({ [worktree]: sampleTab });
  api.setWorktreeDetails(worktree, [main]);
  api.setBranchDetails(worktree, [branch("main", { current: true }), branch("topic")]);
  renderApp({ api, pickFolder: async () => worktree });
  await user.click(screen.getByRole("button", { name: /open folder/i }));
  await screen.findByRole("tab");
  if (view !== "") await user.click(screen.getByRole("button", { name: view }));
  return user;
}

it("themes the Fetch, Pull and Push buttons", async () => {
  await open("");

  const sync = await screen.findByRole("group", { name: "Sync" });

  for (const button of within(sync).getAllByRole("button")) {
    expect(button).toHaveClass("button");
  }
});

it("themes the buttons on the Branches page", async () => {
  await open("Branches");

  const topic = (await screen.findByText("topic", { selector: ".branch-name" })).closest("li") as HTMLElement;

  expect(within(topic).getByRole("button", { name: "Check out topic" })).toHaveClass("button");
  expect(screen.getByRole("button", { name: "Create" })).toHaveClass("button");

  await userEvent.click(within(topic).getByRole("button", { name: "Options for topic" }));

  expect(screen.getByRole("menuitem", { name: "Delete" })).toHaveClass("danger");
});

it("themes the buttons on the Worktrees page", async () => {
  await open("Worktrees");

  await screen.findByRole("list", { name: "Worktrees" });

  expect(screen.getByRole("button", { name: "Add worktree" })).toHaveClass("button");
  expect(screen.getByRole("button", { name: "Prune" })).toHaveClass("button");
});

it("scrolls the Settings page at the edge of the pane, not beside its narrow column", () => {
  const css = stylesheet("styles.css");

  expect(rule(css, ".settings")).not.toContain("max-width");
  expect(rule(css, ".settings > :not(.segmented)")).toContain("max-width");
});

describe("vertical alignment of button-like controls", () => {
  it.each([".chip", ".type-chip", ".multi-select-button"])("%s centres its content in a box of its own height", (selector) => {
    const declarations = rule(stylesheet("styles.css"), selector);

    expect(declarations, selector).toMatch(/align-items:\s*center/);
    expect(declarations, selector).toMatch(/box-sizing:\s*border-box/);
  });
});
