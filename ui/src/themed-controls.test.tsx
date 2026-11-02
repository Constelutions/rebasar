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
