import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { type CoreApi, type Settings, type WorktreeStatus, defaultSettings } from "./core/api";
import { createStubCoreApi } from "./core/stub";
import { renderApp, sampleTab } from "./test-support";

const worktree = sampleTab.worktreePath;

const status: WorktreeStatus = {
  conflicts: [],
  staged: [{ path: "src/api.ts", originalPath: null, kind: "modified", added: 3, removed: 1 }],
  unstaged: [{ path: "package.json", originalPath: null, kind: "modified", added: 1, removed: 1 }],
};

function withChangesSettings(changes: Partial<Settings["changes"]>) {
  return (api: CoreApi): CoreApi => ({
    ...api,
    settings: async () => ({ ...defaultSettings, changes: { ...defaultSettings.changes, ...changes } }),
  });
}

async function openChanges(wrap: (api: CoreApi) => CoreApi = (api) => api) {
  const user = userEvent.setup();
  const api = wrap(createStubCoreApi({ [worktree]: sampleTab }, { [worktree]: status }));
  renderApp({ api, pickFolder: async () => worktree });
  await user.click(screen.getByRole("button", { name: /open folder/i }));
  await screen.findByRole("tab");
  await user.click(screen.getByRole("button", { name: "Changes" }));
  const files = await screen.findByRole("list", { name: "Changed files" });
  return { user, api, split: files.closest(".split-pane") as HTMLElement };
}

describe("the position of the diff", () => {
  it("puts the diff to the right of the lists by default", async () => {
    const { split } = await openChanges();

    expect(screen.getByRole("radiogroup", { name: "Diff position" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Right" })).toBeChecked();
    expect(split).toHaveAttribute("data-position", "right");
  });

  it("moves the diff below the lists through the toggle and remembers it", async () => {
    const { user, api, split } = await openChanges();

    await user.click(screen.getByRole("radio", { name: "Bottom" }));

    expect(split).toHaveAttribute("data-position", "bottom");
    await waitFor(async () => expect((await api.settings()).changes.diffPosition).toBe("bottom"));
  });

  it("keeps the view of the files when the position changes", async () => {
    const { user, api } = await openChanges();

    await user.click(screen.getByRole("radio", { name: "Bottom" }));

    await waitFor(async () => expect((await api.settings()).changes.filesView).toBe("tree"));
  });

  it("opens the diff at the position the settings default to", async () => {
    const { split } = await openChanges(withChangesSettings({ diffPosition: "bottom" }));

    expect(screen.getByRole("radio", { name: "Bottom" })).toBeChecked();
    expect(split).toHaveAttribute("data-position", "bottom");
  });

  it.each(["right", "bottom"] as const)(
    "keeps the lists, the diff and the commit composer in the pane at the %s position",
    async (diffPosition) => {
      const { split } = await openChanges(withChangesSettings({ diffPosition }));

      expect(within(split).getByRole("list", { name: "Changed files" })).toBeInTheDocument();
      expect(within(split).getByText("src/api.ts", { selector: ".diff-path bdi" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Commit" })).toBeInTheDocument();
      expect(split).not.toContainElement(screen.getByRole("button", { name: "Commit" }));
    },
  );
});
