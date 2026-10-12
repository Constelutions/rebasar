import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { ConflictFile, FileChange, WorktreeStatus } from "./core/api";
import { createStubCoreApi } from "./core/stub";
import { renderApp, sampleTab } from "./test-support";

const worktree = sampleTab.worktreePath;

function conflicted(path: string): FileChange {
  return { path, originalPath: null, kind: "conflicted", added: null, removed: null };
}

const textFile: ConflictFile = {
  path: "a.txt",
  kind: "text",
  ours: "one\nmain\nthree\nMAIN END\n",
  theirs: "one\ntopic\nthree\nTOPIC END\n",
  segments: [
    { kind: "text", text: "one\n" },
    { kind: "conflict", ours: "main\n", theirs: "topic\n" },
    { kind: "text", text: "three\n" },
    { kind: "conflict", ours: "MAIN END\n", theirs: "TOPIC END\n" },
  ],
  deletedBy: null,
  mergeToolConfigured: false,
};

async function openConflicts(files: ConflictFile[]) {
  const user = userEvent.setup();
  const status: WorktreeStatus = {
    conflicts: files.map((file) => conflicted(file.path)),
    staged: [],
    unstaged: [],
  };
  const api = createStubCoreApi({ [worktree]: sampleTab }, { [worktree]: status });
  for (const file of files) api.setConflictFile(worktree, file);
  renderApp({ api, pickFolder: async () => worktree });
  await user.click(screen.getByRole("button", { name: /open folder/i }));
  await screen.findByRole("tab");
  await user.click(screen.getByRole("button", { name: "Conflicts" }));
  return { user, api };
}

it("says so when there is nothing in conflict", async () => {
  await openConflicts([]);

  expect(await screen.findByText(/No conflicts/)).toBeInTheDocument();
});

it("lists the conflicted files and shows the first one's ours, theirs and result panes", async () => {
  await openConflicts([textFile]);

  const files = await screen.findByRole("list", { name: "Conflicted files" });
  expect(within(files).getByRole("button", { name: "a.txt" })).toBeInTheDocument();
  const detail = await screen.findByRole("region", { name: "Conflict in a.txt" });
  expect(within(within(detail).getByRole("region", { name: "Ours" })).getByText(/MAIN END/)).toBeInTheDocument();
  expect(within(within(detail).getByRole("region", { name: "Theirs" })).getByText(/TOPIC END/)).toBeInTheDocument();
  expect(within(detail).getByRole("textbox", { name: "Result" })).toHaveValue(
    "one\n<<<<<<< ours\nmain\n=======\ntopic\n>>>>>>> theirs\nthree\n<<<<<<< ours\nMAIN END\n=======\nTOPIC END\n>>>>>>> theirs\n",
  );
});

it("cannot be marked resolved while conflict markers are left", async () => {
  await openConflicts([textFile]);

  expect(await screen.findByRole("button", { name: "Mark resolved" })).toBeDisabled();
});

it("accepts ours, theirs or both for each hunk and then marks the file resolved", async () => {
  const { user, api } = await openConflicts([textFile]);
  await screen.findByRole("region", { name: "Conflict in a.txt" });

  await user.click(screen.getByRole("button", { name: "Accept ours for hunk 1" }));
  await user.click(screen.getByRole("button", { name: "Accept both for hunk 2" }));

  expect(screen.getByRole("textbox", { name: "Result" })).toHaveValue("one\nmain\nthree\nMAIN END\nTOPIC END\n");
  await user.click(screen.getByRole("button", { name: "Mark resolved" }));

  await waitFor(() => expect(api.conflictActions).toEqual(["resolve:a.txt"]));
  expect(api.resolvedContents.get("a.txt")).toBe("one\nmain\nthree\nMAIN END\nTOPIC END\n");
  expect(await screen.findByText(/No conflicts/)).toBeInTheDocument();
});

it("accepts theirs for a hunk", async () => {
  const { user } = await openConflicts([textFile]);
  await screen.findByRole("region", { name: "Conflict in a.txt" });

  await user.click(screen.getByRole("button", { name: "Accept theirs for hunk 1" }));

  expect(screen.getByRole("textbox", { name: "Result" })).toHaveValue(
    "one\ntopic\nthree\n<<<<<<< ours\nMAIN END\n=======\nTOPIC END\n>>>>>>> theirs\n",
  );
});

it("lets the result be edited freely and saves what was typed", async () => {
  const { user, api } = await openConflicts([textFile]);
  const result = await screen.findByRole("textbox", { name: "Result" });

  await user.clear(result);
  await user.type(result, "my own version");
  await user.click(screen.getByRole("button", { name: "Mark resolved" }));

  await waitFor(() => expect(api.resolvedContents.get("a.txt")).toBe("my own version"));
});

it("resolves a binary conflict by choosing a side", async () => {
  const binary: ConflictFile = { ...textFile, path: "logo.png", kind: "binary", ours: "", theirs: "", segments: [] };
  const { user, api } = await openConflicts([binary]);

  await user.click(await screen.findByRole("button", { name: "Keep theirs" }));

  await waitFor(() => expect(api.conflictActions).toEqual(["side:logo.png:theirs"]));
});

it("resolves a delete/modify conflict by keeping or deleting the file", async () => {
  const deleteModify: ConflictFile = {
    ...textFile,
    path: "old.txt",
    kind: "deleteModify",
    theirs: "",
    segments: [],
    deletedBy: "theirs",
  };
  const { user, api } = await openConflicts([deleteModify]);

  expect(await screen.findByText(/Their side deleted this file/)).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Delete the file (theirs)" }));

  await waitFor(() => expect(api.conflictActions).toEqual(["side:old.txt:theirs"]));
});

it("shows resolve in terminal for a conflict it cannot resolve when no merge tool is set", async () => {
  const rename: ConflictFile = { ...textFile, path: "renamed.txt", kind: "unsupported", segments: [] };
  await openConflicts([rename]);

  expect(await screen.findByText(/Resolve in terminal/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Open merge tool" })).not.toBeInTheDocument();
});

it("hands a conflict it cannot resolve to the configured merge tool", async () => {
  const rename: ConflictFile = {
    ...textFile,
    path: "renamed.txt",
    kind: "unsupported",
    segments: [],
    mergeToolConfigured: true,
  };
  const { user, api } = await openConflicts([rename]);

  await user.click(await screen.findByRole("button", { name: "Open merge tool" }));

  await waitFor(() => expect(api.conflictActions).toEqual(["tool:renamed.txt"]));
});

it("moves on to the next file once one is resolved", async () => {
  const second: ConflictFile = { ...textFile, path: "b.txt", segments: [{ kind: "text", text: "plain\n" }] };
  const { user } = await openConflicts([textFile, second]);
  await screen.findByRole("region", { name: "Conflict in a.txt" });

  await user.click(screen.getByRole("button", { name: "Accept ours for hunk 1" }));
  await user.click(screen.getByRole("button", { name: "Accept ours for hunk 2" }));
  await user.click(screen.getByRole("button", { name: "Mark resolved" }));

  expect(await screen.findByRole("region", { name: "Conflict in b.txt" })).toBeInTheDocument();
});

it("lets the banner continue once every file is resolved", async () => {
  const user = userEvent.setup();
  const api = createStubCoreApi(
    { [worktree]: sampleTab },
    { [worktree]: { conflicts: [conflicted("a.txt")], staged: [], unstaged: [] } },
  );
  api.setConflictFile(worktree, textFile);
  api.setOperation(worktree, { kind: "merge", step: null, conflicts: 1, canSkip: false });
  renderApp({ api, pickFolder: async () => worktree });
  await user.click(screen.getByRole("button", { name: /open folder/i }));
  await screen.findByRole("tab");
  await user.click(screen.getByRole("button", { name: "Conflicts" }));
  await screen.findByRole("region", { name: "Conflict in a.txt" });
  const banner = screen.getByRole("region", { name: "Operation in progress" });
  expect(within(banner).getByRole("button", { name: "Continue" })).toBeDisabled();

  await user.click(screen.getByRole("button", { name: "Accept ours for hunk 1" }));
  await user.click(screen.getByRole("button", { name: "Accept ours for hunk 2" }));
  await user.click(screen.getByRole("button", { name: "Mark resolved" }));
  api.setOperation(worktree, { kind: "merge", step: null, conflicts: 0, canSkip: false });

  await waitFor(() => expect(within(screen.getByRole("region", { name: "Operation in progress" })).getByRole("button", { name: "Continue" })).toBeEnabled());
  await user.click(within(screen.getByRole("region", { name: "Operation in progress" })).getByRole("button", { name: "Continue" }));

  await waitFor(() => expect(api.operationActions).toEqual(["continue"]));
});
