import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ConfirmationDialog } from "./components/ConfirmationDialog";
import type { FileChange, Loss, WorktreeStatus } from "./core/api";
import { createStubCoreApi } from "./core/stub";
import { renderApp, sampleTab } from "./test-support";

function change(path: string, kind: FileChange["kind"], added = 1, removed = 0): FileChange {
  return { path, originalPath: null, kind, added, removed };
}

const status: WorktreeStatus = {
  conflicts: [change("clash.txt", "conflicted")],
  staged: [change("src/api.ts", "modified")],
  unstaged: [
    change("notes.txt", "untracked", 3, 0),
    change("src/stub.ts", "modified", 2, 1),
    change("src/old.ts", "deleted", 0, 7),
  ],
};

async function openChanges() {
  const user = userEvent.setup();
  const api = createStubCoreApi(
    { [sampleTab.worktreePath]: sampleTab },
    { [sampleTab.worktreePath]: status },
  );
  renderApp({ api, pickFolder: async () => sampleTab.worktreePath });
  await user.click(screen.getByRole("button", { name: /open folder/i }));
  await user.click(screen.getByRole("button", { name: "Changes" }));
  await screen.findByRole("form", { name: "Commit" });
  return { user, api };
}

function unstaged() {
  return within(screen.getByRole("list", { name: "Changed files" }));
}

async function discardFromMenu(user: ReturnType<typeof userEvent.setup>, path: string) {
  await user.click(screen.getByRole("button", { name: `Options for ${path}` }));
  await user.click(screen.getByRole("menuitem", { name: "Discard" }));
}

describe("discarding changes", () => {
  it("asks first, naming the file that would be lost, and does nothing until confirmed", async () => {
    const { user, api } = await openChanges();

    await discardFromMenu(user, "notes.txt");

    const dialog = await screen.findByRole("alertdialog", { name: "Discard changes" });
    expect(dialog).toHaveTextContent("1 file with uncommitted changes will be lost");
    expect(within(dialog).getByRole("list", { name: "Files that will be lost" })).toHaveTextContent(
      "notes.txt",
    );
    expect(api.discards).toEqual([]);
    expect(unstaged().getByText("notes.txt")).toBeInTheDocument();
  });

  it("discards the file once the user confirms", async () => {
    const { user, api } = await openChanges();
    await discardFromMenu(user, "notes.txt");

    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Discard" }));

    await vi.waitFor(() =>
      expect(api.discards).toEqual([
        { worktreePath: sampleTab.worktreePath, paths: ["notes.txt"] },
      ]),
    );
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    await vi.waitFor(() => expect(unstaged().queryByText("notes.txt")).not.toBeInTheDocument());
  });

  it("keeps everything when the user cancels", async () => {
    const { user, api } = await openChanges();
    await discardFromMenu(user, "notes.txt");

    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(api.discards).toEqual([]);
    expect(unstaged().getByText("notes.txt")).toBeInTheDocument();
  });

  it("cancels on Escape and starts with Cancel focused", async () => {
    const { user, api } = await openChanges();
    await discardFromMenu(user, "notes.txt");

    expect(await within(await screen.findByRole("alertdialog")).findByRole("button", { name: "Cancel" })).toHaveFocus();
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(api.discards).toEqual([]);
  });

  it("discards every unstaged file from Discard all, listing all of them in the dialog", async () => {
    const { user, api } = await openChanges();

    await user.click(screen.getByRole("button", { name: "Unstaged options" }));
    await user.click(screen.getByRole("menuitem", { name: "Discard all" }));

    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("3 files with uncommitted changes will be lost");
    for (const path of ["notes.txt", "src/stub.ts", "src/old.ts"]) {
      expect(dialog).toHaveTextContent(path);
    }
    expect(dialog).not.toHaveTextContent("src/api.ts");
    expect(dialog).not.toHaveTextContent("clash.txt");

    await user.click(within(dialog).getByRole("button", { name: "Discard" }));
    await vi.waitFor(() =>
      expect(api.discards).toEqual([
        {
          worktreePath: sampleTab.worktreePath,
          paths: ["notes.txt", "src/stub.ts", "src/old.ts"],
        },
      ]),
    );
  });

  it("keeps Stage on the row and opens the rest of the actions on a right-click", async () => {
    const { user } = await openChanges();

    expect(screen.getByRole("button", { name: "Stage notes.txt" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Discard notes.txt" })).not.toBeInTheDocument();

    await user.pointer({ keys: "[MouseRight]", target: unstaged().getByText("notes.txt") });

    expect(screen.getByRole("menuitem", { name: "Discard" })).toBeInTheDocument();
  });

  it("offers no discard for staged or conflicted files", async () => {
    await openChanges();

    await userEvent.click(screen.getByRole("button", { name: "Options for src/api.ts" }));
    expect(screen.queryByRole("menuitem", { name: "Discard" })).not.toBeInTheDocument();
  });
});

describe("safe mutations", () => {
  it("never ask for confirmation to stage, unstage or commit", async () => {
    const { user, api } = await openChanges();

    await user.click(screen.getByRole("button", { name: "Stage notes.txt" }));
    await screen.findByRole("button", { name: "Unstage notes.txt" });
    await user.click(screen.getByRole("button", { name: "Unstage notes.txt" }));
    await unstaged().findByText("notes.txt");
    await user.click(screen.getByRole("button", { name: "Stage src/stub.ts" }));
    await user.type(screen.getByRole("textbox", { name: "Commit message" }), "Message");
    await user.click(screen.getByRole("button", { name: "Commit" }));

    await vi.waitFor(() => expect(api.commits).toHaveLength(1));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(api.assessedMutations).toEqual([]);
  });
});

describe("the confirmation dialog", () => {
  const emptyLoss: Loss = { files: [], commits: 0, unpushedCommits: 0, commitList: [] };

  function renderDialog(loss: Loss) {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmationDialog
        title="Reset hard"
        confirmLabel="Reset"
        loss={loss}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    return { onConfirm, onCancel, dialog: screen.getByRole("alertdialog", { name: "Reset hard" }) };
  }

  it("says that Rebasar has no undo and that Git's reflog is the only recovery path", () => {
    const { dialog } = renderDialog({ ...emptyLoss, commits: 1 });

    expect(dialog).toHaveTextContent("Rebasar has no undo");
    expect(dialog).toHaveTextContent("Git's reflog is the only recovery path");
  });

  it("warns that uncommitted changes are not in the reflog when files would be lost", () => {
    const { dialog } = renderDialog({
      ...emptyLoss,
      files: [{ path: "a.txt", originalPath: null, kind: "modified", added: 1, removed: 1 }],
    });

    expect(dialog).toHaveTextContent("it does not record uncommitted changes");
  });

  it("states the commits that become unreachable and how many of them are on no remote", () => {
    const { dialog } = renderDialog({ ...emptyLoss, commits: 3, unpushedCommits: 2 });

    expect(dialog).toHaveTextContent(
      "3 commits will no longer be reachable from any branch, and 2 of them exist on no remote.",
    );
    expect(dialog).not.toHaveTextContent("uncommitted");
    expect(within(dialog).queryByRole("list")).not.toBeInTheDocument();
  });

  it("leaves out the unpushed count when every commit is on a remote", () => {
    const { dialog } = renderDialog({ ...emptyLoss, commits: 1 });

    expect(dialog).toHaveTextContent("1 commit will no longer be reachable from any branch.");
    expect(dialog).not.toHaveTextContent("remote");
  });

  it("names the listed commits and says how many more there are", () => {
    const { dialog } = renderDialog({
      ...emptyLoss,
      commits: 3,
      commitList: [
        { shortId: "abc1234", subject: "Add parser" },
        { shortId: "def5678", subject: "Fix parser" },
      ],
    });

    const list = within(dialog).getByRole("list", { name: "Commits that will be lost" });
    expect(within(list).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "abc1234Add parser",
      "def5678Fix parser",
    ]);
    expect(dialog).toHaveTextContent("and 1 more");
  });

  it("shows a warning about who else is affected when it has one", () => {
    render(
      <ConfirmationDialog
        title="Delete remote branch"
        confirmLabel="Delete"
        loss={{ ...emptyLoss, commits: 1 }}
        warning="Everyone who shares origin loses topic."
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByRole("alertdialog")).toHaveTextContent("Everyone who shares origin loses topic.");
  });

  it("reports what the buttons do", async () => {
    const user = userEvent.setup();
    const { dialog, onConfirm, onCancel } = renderDialog({ ...emptyLoss, commits: 1 });

    await user.click(within(dialog).getByRole("button", { name: "Reset" }));
    expect(onConfirm).toHaveBeenCalledOnce();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("keeps keyboard focus inside while it is open", async () => {
    const user = userEvent.setup();
    const { dialog } = renderDialog({ ...emptyLoss, commits: 1 });
    const cancel = within(dialog).getByRole("button", { name: "Cancel" });
    const confirm = within(dialog).getByRole("button", { name: "Reset" });

    expect(cancel).toHaveFocus();
    await user.tab();
    expect(confirm).toHaveFocus();
    await user.tab();
    expect(cancel).toHaveFocus();
    await user.tab({ shift: true });
    expect(confirm).toHaveFocus();
  });
});
