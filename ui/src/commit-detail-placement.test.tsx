import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { type CoreApi, type FileDiff, type Settings, defaultSettings } from "./core/api";
import { COPY_DEBOUNCE_MS } from "./useCopyOnSelect";
import { commitDiffKey, commitKey, createStubCoreApi } from "./core/stub";
import { commitRow, renderApp, sampleTab } from "./test-support";

const worktree = sampleTab.worktreePath;
const commitId = "a".repeat(40);
const path = "src/parser.rs";

const diff: FileDiff = {
  path,
  originalPath: null,
  modeChange: null,
  content: {
    kind: "text",
    hunks: [
      {
        oldStart: 1,
        oldLines: 0,
        newStart: 1,
        newLines: 1,
        lines: [{ kind: "added", text: "fn parse() {}", oldNumber: null, newNumber: 1 }],
      },
    ],
  },
};

function withHistorySettings(history: Partial<Settings["history"]>) {
  return (api: CoreApi): CoreApi => ({
    ...api,
    settings: async () => ({ ...defaultSettings, history: { ...defaultSettings.history, ...history } }),
  });
}

async function showHistory(wrap: (api: CoreApi) => CoreApi = (api) => api) {
  const user = userEvent.setup();
  const api = wrap(
    createStubCoreApi(
      { [worktree]: sampleTab },
      {},
      { [worktree]: [commitRow({ id: commitId, subject: "Add the parser" })] },
      {},
      {},
      undefined,
      undefined,
      {
        commitDetails: {
          [commitKey(commitId, 0)]: {
            id: commitId,
            shortId: commitId.slice(0, 8),
            authorName: "Ada Lovelace",
            authorEmail: "ada@example.com",
            authorTimestamp: 1_700_000_000,
            message: "Add the parser",
            parents: [],
            files: [{ path, originalPath: null, kind: "modified", added: 1, removed: 0 }],
          },
        },
        commitDiffs: { [commitDiffKey({ commit: commitId, parent: 0, path })]: diff },
      },
    ),
  );
  renderApp({ api, pickFolder: async () => worktree });
  await user.click(screen.getByRole("button", { name: /open folder/i }));
  await screen.findByRole("tab");
  await user.click(screen.getByRole("button", { name: "History" }));
  await screen.findByRole("list", { name: "Commit history" });
  return { user, api };
}

async function selectCommit(user: ReturnType<typeof userEvent.setup>) {
  const history = screen.getByRole("list", { name: "Commit history" });
  await user.click(within(history).getByText("Add the parser"));
  return screen.findByRole("region", { name: "Commit detail" });
}

function detailPane() {
  return screen.queryByRole("region", { name: "Commit detail" });
}

describe("closing the details", () => {
  it("closes them when the selected commit is clicked again", async () => {
    const { user } = await showHistory();
    await selectCommit(user);

    await user.click(within(screen.getByRole("list", { name: "Commit history" })).getByText("Add the parser"));

    expect(detailPane()).not.toBeInTheDocument();
    expect(screen.getByRole("listitem")).not.toHaveAttribute("aria-current");
  });

  it("opens them again when the commit is clicked a third time", async () => {
    const { user } = await showHistory();
    await selectCommit(user);
    const subject = within(screen.getByRole("list", { name: "Commit history" })).getByText("Add the parser");

    await user.click(subject);
    await user.click(subject);

    expect(await screen.findByRole("region", { name: "Commit detail" })).toBeInTheDocument();
  });
});

describe("the position of the details", () => {
  it("opens them to the right by default", async () => {
    const { user } = await showHistory();
    const pane = await selectCommit(user);

    expect(screen.getByRole("radio", { name: "Right" })).toBeChecked();
    expect(pane.parentElement).toHaveAttribute("data-position", "right");
  });

  it("moves them to the bottom through the toggle and remembers it", async () => {
    const { user, api } = await showHistory();
    const pane = await selectCommit(user);

    await user.click(screen.getByRole("radio", { name: "Bottom" }));

    expect(pane.parentElement).toHaveAttribute("data-position", "bottom");
    await waitFor(async () => expect((await api.settings()).history.detailPosition).toBe("bottom"));
  });

  it("opens them at the position the settings default to", async () => {
    const { user } = await showHistory(withHistorySettings({ detailPosition: "bottom" }));
    const pane = await selectCommit(user);

    expect(screen.getByRole("radio", { name: "Bottom" })).toBeChecked();
    expect(pane.parentElement).toHaveAttribute("data-position", "bottom");
  });

  it("keeps the toggle available when no commit is selected", async () => {
    await showHistory();

    expect(screen.getByRole("radiogroup", { name: "Details position" })).toBeInTheDocument();
    expect(detailPane()).not.toBeInTheDocument();
  });
});

describe("copying a file path", () => {
  function select(element: HTMLElement, start: number, end: number) {
    const text = document.createTreeWalker(element, NodeFilter.SHOW_TEXT).nextNode()!;
    const range = document.createRange();
    range.setStart(text, start);
    range.setEnd(text, end);
    const selection = document.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    act(() => {
      document.dispatchEvent(new Event("selectionchange"));
    });
  }

  async function showDiffOfFile() {
    const { user } = await showHistory();
    await selectCommit(user);
    return screen.findByText(path);
  }

  it("copies exactly the selected text once the selection settles, with a tooltip", async () => {
    const filePath = await showDiffOfFile();

    select(filePath, 4, 10);

    await waitFor(async () => expect(await navigator.clipboard.readText()).toBe("parser"));
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Copied");
  });

  it("copies only the final selection of repeated clicks", async () => {
    const writes: string[] = [];
    const filePath = await showDiffOfFile();
    const write = navigator.clipboard.writeText.bind(navigator.clipboard);
    vi.spyOn(navigator.clipboard, "writeText").mockImplementation(async (text) => {
      writes.push(text);
      return write(text);
    });

    select(filePath, 0, 3);
    select(filePath, 0, 6);
    select(filePath, 4, 10);

    await waitFor(() => expect(writes).toEqual(["parser"]));
    await new Promise((resolve) => setTimeout(resolve, COPY_DEBOUNCE_MS + 100));
    expect(writes).toEqual(["parser"]);
  });

  it("never copies a selection made in the diff itself", async () => {
    const filePath = await showDiffOfFile();
    const lines = await screen.findByRole("list", { name: "Changed lines" });
    const line = within(lines).getByText(/fn parse/);
    const writeText = vi.spyOn(navigator.clipboard, "writeText");

    select(line, 0, 5);
    await new Promise((resolve) => setTimeout(resolve, COPY_DEBOUNCE_MS + 100));

    expect(writeText).not.toHaveBeenCalled();
    expect(filePath).toBeInTheDocument();
  });
});
