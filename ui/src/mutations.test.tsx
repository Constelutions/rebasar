import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { FileChange, WorktreeStatus } from "./core/api";
import { createStubCoreApi } from "./core/stub";
import { renderApp, sampleTab } from "./test-support";

function change(path: string, kind: FileChange["kind"], originalPath: string | null = null): FileChange {
  return { path, originalPath, kind, added: 1, removed: 0 };
}

const status: WorktreeStatus = {
  conflicts: [],
  staged: [change("src/api.ts", "modified")],
  unstaged: [change("notes.txt", "untracked"), change("src/stub.ts", "modified")],
};

async function openChanges(worktreeStatus: WorktreeStatus = status) {
  const user = userEvent.setup();
  const api = createStubCoreApi(
    { [sampleTab.worktreePath]: sampleTab },
    { [sampleTab.worktreePath]: worktreeStatus },
  );
  renderApp({ api, pickFolder: async () => sampleTab.worktreePath });
  await user.click(screen.getByRole("button", { name: /open folder/i }));
  await user.click(screen.getByRole("button", { name: "Changes" }));
  await screen.findByRole("form", { name: "Commit" });
  return { user, api };
}

describe("staging", () => {
  it("moves a file to Staged as soon as its Stage button is pressed", async () => {
    const { user } = await openChanges();

    await user.click(screen.getByRole("button", { name: "Stage notes.txt" }));

    await screen.findByRole("button", { name: "Unstage notes.txt" });
    expect(screen.queryByRole("button", { name: "Stage notes.txt" })).not.toBeInTheDocument();
  });

  it("moves a file back to Unstaged when its Unstage button is pressed", async () => {
    const { user } = await openChanges();

    await user.click(screen.getByRole("button", { name: "Unstage src/api.ts" }));

    await screen.findByRole("button", { name: "Stage src/api.ts" });
    expect(screen.queryByRole("button", { name: "Unstage src/api.ts" })).not.toBeInTheDocument();
  });

  it("names both paths when a renamed file is unstaged", async () => {
    const { user, api } = await openChanges({
      conflicts: [],
      staged: [change("src/new.ts", "renamed", "src/old.ts")],
      unstaged: [],
    });
    const unstage = vi.spyOn(api, "unstageFiles");

    await user.click(await screen.findByRole("button", { name: "Unstage src/new.ts" }));

    expect(unstage).toHaveBeenCalledWith(sampleTab.worktreePath, ["src/new.ts", "src/old.ts"]);
  });

  it("offers no staging buttons for conflicted files", async () => {
    await openChanges({ ...status, conflicts: [change("clash.txt", "conflicted")] });

    expect(screen.queryByRole("button", { name: /^(Stage|Unstage) clash\.txt/ })).not.toBeInTheDocument();
  });
});

describe("committing", () => {
  it("commits the staged files with the typed message and clears the message", async () => {
    const { user, api } = await openChanges();

    await user.type(screen.getByRole("textbox", { name: "Subject" }), "Fix the api");
    await user.click(screen.getByRole("button", { name: "Commit" }));

    await screen.findByText(/no changes|notes\.txt/);
    expect(api.commits).toEqual([
      { worktreePath: sampleTab.worktreePath, message: "Fix the api", amend: false, signOff: false },
    ]);
    expect(screen.getByRole("textbox", { name: "Subject" })).toHaveValue("");
    expect(screen.queryByRole("button", { name: "Unstage src/api.ts" })).not.toBeInTheDocument();
  });

  it("cannot commit without a message or without staged files", async () => {
    const { user } = await openChanges({ conflicts: [], staged: [], unstaged: status.unstaged });
    const commit = screen.getByRole("button", { name: "Commit" });
    const message = screen.getByRole("textbox", { name: "Subject" });

    await user.type(message, "Message but nothing staged");
    expect(commit).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Stage notes.txt" }));
    await screen.findByRole("button", { name: "Unstage notes.txt" });
    expect(commit).toBeEnabled();

    await user.clear(message);
    expect(commit).toBeDisabled();
  });

  it("keeps the message and opens the output when the commit fails", async () => {
    const { user, api } = await openChanges();
    api.failNextMutation({ exitCode: 1, output: ["lint failed: no tabs please"] });

    await user.type(screen.getByRole("textbox", { name: "Subject" }), "Fix the api");
    await user.click(screen.getByRole("button", { name: "Commit" }));

    const output = await screen.findByRole("article", { name: "Commit" });
    expect(output).toHaveTextContent("lint failed: no tabs please");
    expect(output).toHaveTextContent("failed (exit code 1)");
    expect(screen.getByRole("textbox", { name: "Subject" })).toHaveValue("Fix the api");
  });
});

describe("output panel", () => {
  it("starts collapsed and says what the last mutation did", async () => {
    const { user } = await openChanges();
    await user.click(screen.getByRole("button", { name: "Stage notes.txt" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Stage notes.txt: succeeded");
    expect(screen.getByRole("button", { name: "Output" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
  });

  it("expands and collapses on demand", async () => {
    const { user } = await openChanges();
    await user.click(screen.getByRole("button", { name: "Stage notes.txt" }));
    const toggle = screen.getByRole("button", { name: "Output" });

    await user.click(toggle);
    expect(await screen.findByRole("article", { name: "Stage notes.txt" })).toBeInTheDocument();

    await user.click(toggle);
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
  });

  it("streams output while the mutation runs and shows progress with a Cancel button", async () => {
    const { user, api } = await openChanges();
    await user.click(screen.getByRole("button", { name: "Output" }));
    const worktreePath = sampleTab.worktreePath;

    act(() => {
      api.emitEvent({ type: "mutationQueued", mutation: { id: 40, worktreePath, title: "Push" } });
      api.emitEvent({ type: "mutationStarted", mutationId: 40 });
      api.emitEvent({
        type: "mutationOutput",
        mutationId: 40,
        stream: "stderr",
        text: "pre-push hook: running tests",
        transient: false,
      });
    });

    expect(screen.getByRole("status")).toHaveTextContent("Running: Push");
    expect(screen.getByRole("progressbar", { name: "Push in progress" })).toBeInTheDocument();
    expect(screen.getByRole("article", { name: "Push" })).toHaveTextContent(
      "pre-push hook: running tests",
    );

    await user.click(screen.getByRole("button", { name: "Cancel Push" }));
    expect(api.cancelledMutations).toEqual([40]);

    act(() => {
      api.emitEvent({
        type: "mutationFinished",
        mutationId: 40,
        outcome: { kind: "cancelled" },
      });
    });

    expect(screen.getByRole("status")).toHaveTextContent("Push: cancelled");
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel Push" })).not.toBeInTheDocument();
  });

  it("shows a queued mutation as waiting", async () => {
    const { api } = await openChanges();

    act(() => {
      api.emitEvent({
        type: "mutationQueued",
        mutation: { id: 50, worktreePath: sampleTab.worktreePath, title: "Commit" },
      });
    });

    expect(screen.getByRole("status")).toHaveTextContent("Waiting: Commit");
  });

  it("replaces a progress line with the next line instead of stacking them", async () => {
    const { user, api } = await openChanges();
    await user.click(screen.getByRole("button", { name: "Output" }));
    const worktreePath = sampleTab.worktreePath;
    const output = (text: string, transient: boolean) =>
      api.emitEvent({ type: "mutationOutput", mutationId: 60, stream: "stderr", text, transient });

    act(() => {
      api.emitEvent({ type: "mutationQueued", mutation: { id: 60, worktreePath, title: "Clone" } });
      output("Receiving objects: 10%", true);
      output("Receiving objects: 60%", true);
    });

    const run = screen.getByRole("article", { name: "Clone" });
    expect(run).toHaveTextContent("Receiving objects: 60%");
    expect(run).not.toHaveTextContent("10%");

    act(() => output("Receiving objects: 100%, done.", false));

    expect(run).toHaveTextContent("Receiving objects: 100%, done.");
    expect(run).not.toHaveTextContent("60%");
  });
});
