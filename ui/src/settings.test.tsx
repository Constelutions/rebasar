import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  type CoreApi,
  type FileChange,
  type Settings,
  type WorktreeStatus,
  defaultSettings,
} from "./core/api";
import { createStubCoreApi, diffKey } from "./core/stub";
import { renderApp, sampleTab } from "./test-support";

const change: FileChange = {
  path: "beta.txt",
  originalPath: null,
  kind: "modified",
  added: 1,
  removed: 1,
};
const status: WorktreeStatus = { conflicts: [], staged: [], unstaged: [change] };

interface Options {
  settings?: Settings;
  identity?: { name: string | null; email: string | null };
  repositoryIdentity?: { name: string | null; email: string | null };
  wrap?: (api: CoreApi) => CoreApi;
}

function render({ settings, identity, repositoryIdentity, wrap = (api) => api }: Options = {}) {
  const stub = createStubCoreApi(
    { [sampleTab.worktreePath]: sampleTab },
    { [sampleTab.worktreePath]: status },
    {},
    {
      [diffKey({ list: "unstaged", path: "beta.txt" })]: {
        path: "beta.txt",
        originalPath: null,
        modeChange: null,
        content: {
          kind: "text",
          hunks: [
            {
              oldStart: 1,
              oldLines: 2,
              newStart: 1,
              newLines: 2,
              lines: [
                { kind: "context", text: "one", oldNumber: 1, newNumber: 1 },
                { kind: "removed", text: "two", oldNumber: 2, newNumber: null },
                { kind: "added", text: "TWO", oldNumber: null, newNumber: 2 },
              ],
            },
          ],
        },
      },
    },
    {},
    undefined,
    { settings, identity, repositoryIdentity },
  );
  const api = wrap(stub);
  const user = userEvent.setup();
  renderApp({ api, pickFolder: async () => sampleTab.worktreePath });
  return { user, api, stub };
}

async function openSettings(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Settings" }));
  return screen.findByRole("form", { name: "Git identity" });
}

function scopeSwitch() {
  return within(screen.getByRole("radiogroup", { name: "Scope" }));
}

async function openRepositorySettings(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /open folder/i }));
  await screen.findByRole("tab");
  await openSettings(user);
  await user.click(scopeSwitch().getByLabelText("Repository"));
  return within(await screen.findByRole("form", { name: "Git identity" }));
}

async function openChanges(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /open folder/i }));
  await screen.findByRole("tab");
  await user.click(screen.getByRole("button", { name: "Changes" }));
  await screen.findByRole("region", { name: "Diff of beta.txt" });
}

it("opens from the sidebar and with Ctrl+,", async () => {
  const { user } = render();

  await user.keyboard("{Control>},{/Control}");

  expect(await screen.findByRole("heading", { level: 1, name: "Settings" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Settings" })).toHaveAttribute("aria-current", "page");
});

it("shows the Git identity from the Git configuration", async () => {
  const { user } = render({ identity: { name: "Ada Lovelace", email: "ada@example.com" } });

  const form = within(await openSettings(user));

  await waitFor(() => expect(form.getByLabelText("Name")).toHaveValue("Ada Lovelace"));
  expect(form.getByLabelText("Email")).toHaveValue("ada@example.com");
});

it("saves a changed identity through the core and confirms it", async () => {
  const { user, api } = render({ identity: { name: "Ada", email: "ada@example.com" } });
  const form = within(await openSettings(user));
  await waitFor(() => expect(form.getByLabelText("Name")).toHaveValue("Ada"));

  await user.clear(form.getByLabelText("Name"));
  await user.type(form.getByLabelText("Name"), "Ada Lovelace");
  await user.click(form.getByRole("button", { name: "Save identity" }));

  expect(await form.findByText("Saved")).toBeInTheDocument();
  expect(await api.gitIdentity()).toEqual({ name: "Ada Lovelace", email: "ada@example.com" });
});

it("removes a value that is cleared", async () => {
  const { user, api } = render({ identity: { name: "Ada", email: "ada@example.com" } });
  const form = within(await openSettings(user));
  await waitFor(() => expect(form.getByLabelText("Email")).toHaveValue("ada@example.com"));

  await user.clear(form.getByLabelText("Email"));
  await user.click(form.getByRole("button", { name: "Save identity" }));

  await form.findByText("Saved");
  expect(await api.gitIdentity()).toEqual({ name: "Ada", email: null });
});

it("explains why the identity could not be saved", async () => {
  const { user } = render({
    wrap: (api) => ({
      ...api,
      setGitIdentity: async () => {
        throw { kind: "unexpected", message: "git config failed: permission denied" };
      },
    }),
  });
  const form = within(await openSettings(user));

  await user.click(form.getByRole("button", { name: "Save identity" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("permission denied");
  expect(form.queryByText("Saved")).not.toBeInTheDocument();
});

describe("Scope", () => {
  it("starts at the Global Scope, with a Repository one to switch to", async () => {
    const { user } = render();
    await user.click(screen.getByRole("button", { name: /open folder/i }));
    await screen.findByRole("tab");
    await openSettings(user);

    expect(scopeSwitch().getByLabelText("Global")).toBeChecked();
    expect(scopeSwitch().getByLabelText("Repository")).toBeEnabled();
    expect(screen.getByLabelText("Whitespace")).toBeInTheDocument();
  });

  it("offers no Repository Scope while no Tab is open", async () => {
    const { user } = render();
    await openSettings(user);

    expect(scopeSwitch().getByLabelText("Repository")).toBeDisabled();
  });

  it("keeps the other settings at the Global Scope only", async () => {
    const { user } = render();
    await openRepositorySettings(user);

    expect(screen.queryByLabelText("Whitespace")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Code font size")).not.toBeInTheDocument();
  });

  it("says an unset Repository identity inherits the Global one and which value applies", async () => {
    const { user } = render({ identity: { name: "Ada Lovelace", email: "ada@example.com" } });

    const form = await openRepositorySettings(user);

    expect(await form.findByText("Inherits the global name: Ada Lovelace")).toBeInTheDocument();
    expect(form.getByText("Inherits the global email: ada@example.com")).toBeInTheDocument();
    expect(form.getByLabelText("Name")).toHaveValue("");
    expect(form.getByLabelText("Name")).toHaveAttribute("placeholder", "Ada Lovelace");
  });

  it("says a Repository value overrides the Global one", async () => {
    const { user } = render({
      identity: { name: "Ada Lovelace", email: "ada@example.com" },
      repositoryIdentity: { name: "Ada at Work", email: null },
    });

    const form = await openRepositorySettings(user);

    await waitFor(() => expect(form.getByLabelText("Name")).toHaveValue("Ada at Work"));
    expect(form.getByText("Overrides the global name: Ada Lovelace")).toBeInTheDocument();
    expect(form.getByText("Inherits the global email: ada@example.com")).toBeInTheDocument();
  });

  it("saves the identity to the Repository and leaves the Global one untouched", async () => {
    const { user, api } = render({ identity: { name: "Ada Lovelace", email: "ada@example.com" } });
    const form = await openRepositorySettings(user);
    await form.findByText("Inherits the global name: Ada Lovelace");

    await user.type(form.getByLabelText("Name"), "Ada at Work");
    await user.type(form.getByLabelText("Email"), "ada@work.example");
    await user.click(form.getByRole("button", { name: "Save identity" }));

    expect(await form.findByText("Saved")).toBeInTheDocument();
    expect(await api.repositoryGitIdentity(sampleTab.worktreePath)).toEqual({
      name: "Ada at Work",
      email: "ada@work.example",
    });
    expect(await api.gitIdentity()).toEqual({ name: "Ada Lovelace", email: "ada@example.com" });
    expect(form.getByText("Overrides the global name: Ada Lovelace")).toBeInTheDocument();
  });

  it("falls back to the Global identity when the Repository one is cleared", async () => {
    const { user, api } = render({
      identity: { name: "Ada Lovelace", email: "ada@example.com" },
      repositoryIdentity: { name: "Ada at Work", email: "ada@work.example" },
    });
    const form = await openRepositorySettings(user);
    await waitFor(() => expect(form.getByLabelText("Name")).toHaveValue("Ada at Work"));

    await user.clear(form.getByLabelText("Name"));
    await user.clear(form.getByLabelText("Email"));
    await user.click(form.getByRole("button", { name: "Save identity" }));

    expect(await form.findByText("Inherits the global name: Ada Lovelace")).toBeInTheDocument();
    expect(form.getByText("Inherits the global email: ada@example.com")).toBeInTheDocument();
    expect(await api.repositoryGitIdentity(sampleTab.worktreePath)).toEqual({
      name: null,
      email: null,
    });
  });

  it("shows the Global identity again, unchanged, when switching back", async () => {
    const { user } = render({ identity: { name: "Ada Lovelace", email: "ada@example.com" } });
    const repositoryForm = await openRepositorySettings(user);
    await user.type(repositoryForm.getByLabelText("Name"), "Ada at Work");
    await user.click(repositoryForm.getByRole("button", { name: "Save identity" }));
    await repositoryForm.findByText("Saved");

    await user.click(scopeSwitch().getByLabelText("Global"));

    const globalForm = within(await screen.findByRole("form", { name: "Git identity" }));
    await waitFor(() => expect(globalForm.getByLabelText("Name")).toHaveValue("Ada Lovelace"));
  });

  it("explains why the Repository identity could not be saved", async () => {
    const { user } = render({
      wrap: (api) => ({
        ...api,
        setRepositoryGitIdentity: async () => {
          throw { kind: "unexpected", message: "git config failed: permission denied" };
        },
      }),
    });
    const form = await openRepositorySettings(user);

    await user.click(form.getByRole("button", { name: "Save identity" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("permission denied");
  });
});

it("starts from the stored settings", async () => {
  const { user } = render({
    settings: {
      diff: { whitespace: "ignoreAll", defaultMode: "sideBySide" },
      appearance: { codeFontSize: 14, sidebarCollapsed: false },
      sync: { autoFetch: true, fetchIntervalMinutes: 5 },
      copy: { onSelect: true },
      tabs: { confirmClose: "whenLost", restoreOnLaunch: true },
      history: { ...defaultSettings.history },
      changes: { ...defaultSettings.changes },
      commit: { ...defaultSettings.commit },
      editor: { ...defaultSettings.editor },
      branches: { ...defaultSettings.branches },
    },
  });
  await openSettings(user);

  await waitFor(() => expect(screen.getByLabelText("Whitespace")).toHaveValue("ignoreAll"));
  expect(screen.getByLabelText("Default diff mode")).toHaveValue("sideBySide");
  expect(screen.getByLabelText("Code font size")).toHaveValue("14");
});

it("stores the History filters it opens with as soon as they are picked", async () => {
  const { user, api } = render();
  await openSettings(user);

  expect(screen.getByLabelText("Show only my commits")).not.toBeChecked();
  expect(screen.getByLabelText("Show only merge commits")).not.toBeChecked();
  expect(screen.getByLabelText("Branches")).toHaveValue("all");

  await user.click(screen.getByLabelText("Show only my commits"));
  await user.click(screen.getByLabelText("Show only merge commits"));
  await user.selectOptions(screen.getByLabelText("Branches"), "current");

  await waitFor(async () =>
    expect((await api.settings()).history).toMatchObject({ mine: true, merges: true, allBranches: false }),
  );
});

it("stores the History orientation and graph style it opens with as soon as they are picked", async () => {
  const { user, api } = render();
  await openSettings(user);

  expect(screen.getByLabelText("Orientation")).toHaveValue("vertical");
  expect(screen.getByLabelText("Graph style")).toHaveValue("tree");

  await user.selectOptions(screen.getByLabelText("Graph style"), "linear");
  await waitFor(async () => expect((await api.settings()).history.graphStyle).toBe("linear"));

  await user.selectOptions(screen.getByLabelText("Orientation"), "horizontal");
  await waitFor(async () =>
    expect((await api.settings()).history).toMatchObject({ orientation: "horizontal", graphStyle: "tree" }),
  );
});

it("stores which branches the Branches page lists when it opens as soon as it is picked", async () => {
  const { user, api } = render();
  await openSettings(user);
  expect(screen.getByLabelText("Branches page lists")).toHaveValue("both");

  await user.selectOptions(screen.getByLabelText("Branches page lists"), "remote");
  await waitFor(async () => expect((await api.settings()).branches.filter).toBe("remote"));

  await user.selectOptions(screen.getByLabelText("Branches page lists"), "local");
  await waitFor(async () => expect((await api.settings()).branches.filter).toBe("local"));
});

it("stores whether commits are signed off by default as soon as it is toggled", async () => {
  const { user, api } = render();
  await openSettings(user);
  const toggle = screen.getByLabelText("Sign off commits by default");
  expect(toggle).not.toBeChecked();

  await user.click(toggle);
  await waitFor(async () => expect((await api.settings()).commit.signOffByDefault).toBe(true));

  await user.click(toggle);
  await waitFor(async () => expect((await api.settings()).commit.signOffByDefault).toBe(false));
});

it("stores the default view of the changed files of a commit and of the Staged and Unstaged lists", async () => {
  const { user, api } = render();
  await openSettings(user);

  expect(screen.getByLabelText("Changed files of a commit")).toHaveValue("tree");
  expect(screen.getByLabelText("Staged and Unstaged files")).toHaveValue("tree");

  await user.selectOptions(screen.getByLabelText("Changed files of a commit"), "flat");
  await waitFor(async () => expect((await api.settings()).history.filesView).toBe("flat"));

  await user.selectOptions(screen.getByLabelText("Staged and Unstaged files"), "flat");
  await waitFor(async () => expect((await api.settings()).changes.filesView).toBe("flat"));
});

it("does not offer a Linear graph style for a Horizontal History", async () => {
  const { user } = render();
  await openSettings(user);

  await user.selectOptions(screen.getByLabelText("Orientation"), "horizontal");

  expect(screen.getByRole("option", { name: "Linear" })).toBeDisabled();
  expect(within(screen.getByLabelText("Graph style")).getByRole("option", { name: "Tree" })).toBeEnabled();
});

it("stores a changed diff option as soon as it is picked", async () => {
  const { user, api } = render();
  await openSettings(user);

  await user.selectOptions(screen.getByLabelText("Whitespace"), "ignoreAll");
  await user.selectOptions(screen.getByLabelText("Default diff mode"), "sideBySide");

  await waitFor(async () =>
    expect(await api.settings()).toEqual({
      ...defaultSettings,
      diff: { whitespace: "ignoreAll", defaultMode: "sideBySide" },
    }),
  );
});

it("asks for diffs that ignore whitespace as soon as that option is picked", async () => {
  const { user, stub } = render();
  await openSettings(user);
  await user.selectOptions(screen.getByLabelText("Whitespace"), "ignoreAll");

  await openChanges(user);

  expect(stub.diffRequests.map(({ whitespace }) => whitespace)).toEqual(["ignoreAll"]);
});

it("shows whitespace changes by default", async () => {
  const { user, stub } = render();

  await openChanges(user);

  expect(stub.diffRequests.map(({ whitespace }) => whitespace)).toEqual(["show"]);
});

it("does not compute a diff before the stored settings are known", async () => {
  const { user, stub } = render({
    settings: { ...defaultSettings, diff: { whitespace: "ignoreAll", defaultMode: "unified" } },
  });

  await openChanges(user);

  expect(stub.diffRequests.map(({ whitespace }) => whitespace)).toEqual(["ignoreAll"]);
});

it("opens diffs in the default mode that was picked", async () => {
  const { user } = render();
  await openSettings(user);
  await user.selectOptions(screen.getByLabelText("Default diff mode"), "sideBySide");

  await openChanges(user);

  const mode = screen.getByRole("group", { name: "Diff mode" });
  expect(within(mode).getByRole("button", { name: "Side by side" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

it("applies the code font size to the diff", async () => {
  const { user } = render();
  await openSettings(user);

  await user.selectOptions(screen.getByLabelText("Code font size"), "14");

  expect(document.documentElement.style.getPropertyValue("--diff-font-size")).toBe("14px");
});

it("applies the stored code font size at launch", async () => {
  render({ settings: { ...defaultSettings, appearance: { codeFontSize: 13, sidebarCollapsed: false } } });

  await waitFor(() =>
    expect(document.documentElement.style.getPropertyValue("--diff-font-size")).toBe("13px"),
  );
});
