import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { RebasePlan, RebasePlanEntry } from "./core/api";
import { createStubCoreApi } from "./core/stub";
import { commitRow, localTime, renderApp, sampleTab } from "./test-support";

const worktree = sampleTab.worktreePath;
const ids = ["a".repeat(40), "b".repeat(40), "c".repeat(40)];

function commit(index: number, subject: string, action: "pick" | "edit" = "pick"): RebasePlanEntry {
  const id = ids[index] as string;
  return { kind: "commit", action, commit: id, shortId: id.slice(0, 7), subject, message: subject };
}

const plan: RebasePlan = {
  onto: "d".repeat(40),
  inProgress: false,
  entries: [commit(0, "First"), commit(1, "Second"), commit(2, "Third")],
};

async function openEditor(rebasePlan: RebasePlan = plan) {
  const user = userEvent.setup();
  const api = createStubCoreApi(
    { [worktree]: sampleTab },
    {},
    {
      [worktree]: [
        commitRow({ id: ids[2] as string, subject: "Third", refs: [{ kind: "head", name: "HEAD" }] }),
        commitRow({ id: ids[1] as string, subject: "Second", timestamp: localTime(2026, 1, 4, 12) }),
        commitRow({ id: ids[0] as string, subject: "First", timestamp: localTime(2026, 1, 3, 12) }),
      ],
    },
  );
  api.setRebasePlan(worktree, ids[0] as string, rebasePlan);
  renderApp({ api, pickFolder: async () => worktree });
  await user.click(screen.getByRole("button", { name: /open folder/i }));
  await screen.findByRole("tab");
  await user.click(screen.getByRole("button", { name: "History" }));
  await screen.findByRole("list", { name: "Commit history" });
  fireEvent.contextMenu(screen.getByText("First"), { clientX: 10, clientY: 10 });
  await user.click(await screen.findByRole("menuitem", { name: "Interactive rebase from here…" }));
  const dialog = await screen.findByRole("dialog", { name: "Interactive rebase" });
  await within(dialog).findByRole("list", { name: "Rebase plan" });
  return { user, api, dialog: within(dialog) };
}

function order(dialog: ReturnType<typeof within>) {
  return dialog
    .getAllByRole("listitem")
    .map((item: HTMLElement) => item.querySelector(".commit-subject")?.textContent ?? item.textContent);
}

it("lists the commits to replay, oldest first, each set to pick", async () => {
  const { dialog } = await openEditor();

  expect(order(dialog)).toEqual(["First", "Second", "Third"]);
  expect(dialog.getByLabelText("Action for aaaaaaa")).toHaveValue("pick");
});

it("sets pick, reword, squash, fixup or drop on each commit", async () => {
  const { user, api, dialog } = await openEditor();

  await user.selectOptions(dialog.getByLabelText("Action for bbbbbbb"), "squash");
  await user.selectOptions(dialog.getByLabelText("Action for ccccccc"), "drop");
  await user.click(dialog.getByRole("button", { name: "Start rebase" }));

  await waitFor(() => expect(api.appliedPlans).toHaveLength(1));
  expect(
    api.appliedPlans[0]?.entries.map((entry) => (entry.kind === "commit" ? entry.action : entry.text)),
  ).toEqual(["pick", "squash", "drop"]);
});

it("reorders with the move buttons", async () => {
  const { user, dialog } = await openEditor();

  await user.click(dialog.getByRole("button", { name: "Move ccccccc up" }));
  await user.click(dialog.getByRole("button", { name: "Move aaaaaaa down" }));

  expect(order(dialog)).toEqual(["Third", "First", "Second"]);
  expect(dialog.getByRole("button", { name: "Move ccccccc up" })).toBeDisabled();
  expect(dialog.getByRole("button", { name: "Move bbbbbbb down" })).toBeDisabled();
});

it("reorders by dragging a commit onto another", async () => {
  const { dialog } = await openEditor();
  const rows = dialog.getAllByRole("listitem");

  fireEvent.dragStart(rows[2] as HTMLElement);
  fireEvent.dragOver(rows[0] as HTMLElement);
  fireEvent.drop(rows[0] as HTMLElement);

  expect(order(dialog)).toEqual(["Third", "First", "Second"]);
});

it("asks for the new message of a reworded commit, starting from the current one", async () => {
  const { user, api, dialog } = await openEditor();

  await user.selectOptions(dialog.getByLabelText("Action for bbbbbbb"), "reword");
  const message = dialog.getByRole("textbox", { name: "Message for bbbbbbb" });
  expect(message).toHaveValue("Second");
  await user.clear(message);
  await user.type(message, "Second, reworded");
  await user.click(dialog.getByRole("button", { name: "Start rebase" }));

  await waitFor(() => expect(api.appliedPlans).toHaveLength(1));
  expect(api.appliedPlans[0]?.entries[1]).toMatchObject({ action: "reword", message: "Second, reworded" });
});

it("cannot start with an empty message on a reword", async () => {
  const { user, dialog } = await openEditor();

  await user.selectOptions(dialog.getByLabelText("Action for bbbbbbb"), "reword");
  await user.clear(dialog.getByRole("textbox", { name: "Message for bbbbbbb" }));

  expect(dialog.getByRole("button", { name: "Start rebase" })).toBeDisabled();
});

it("refuses a plan whose first commit is squashed into nothing", async () => {
  const { user, dialog } = await openEditor();

  await user.selectOptions(dialog.getByLabelText("Action for aaaaaaa"), "fixup");

  expect(dialog.getByRole("alert")).toHaveTextContent("nothing before it");
  expect(dialog.getByRole("button", { name: "Start rebase" })).toBeDisabled();
});

it("shows edit, exec and break entries read-only and keeps them in place", async () => {
  const withReadOnly: RebasePlan = {
    ...plan,
    entries: [
      { kind: "line", text: "break" },
      commit(0, "First"),
      commit(1, "Second", "edit"),
      { kind: "line", text: "exec make test" },
      commit(2, "Third"),
    ],
  };
  const { user, api, dialog } = await openEditor(withReadOnly);

  expect(dialog.getByText("break")).toBeInTheDocument();
  expect(dialog.getByText("exec make test")).toBeInTheDocument();
  expect(dialog.getByLabelText("Action for bbbbbbb")).toBeDisabled();
  expect(dialog.queryByRole("button", { name: "Move bbbbbbb up" })).not.toBeInTheDocument();

  await user.click(dialog.getByRole("button", { name: "Move ccccccc up" }));
  await user.click(dialog.getByRole("button", { name: "Start rebase" }));

  await waitFor(() => expect(api.appliedPlans).toHaveLength(1));
  expect(
    api.appliedPlans[0]?.entries.map((entry) => (entry.kind === "line" ? entry.text : `${entry.action}:${entry.subject}`)),
  ).toEqual(["break", "pick:Third", "edit:Second", "exec make test", "pick:First"]);
});

it("closes without rebasing on Cancel", async () => {
  const { user, api, dialog } = await openEditor();

  await user.click(dialog.getByRole("button", { name: "Cancel" }));

  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(api.appliedPlans).toEqual([]);
});

it("leaves the work to the banner and the Conflicts view when the plan stops on a conflict", async () => {
  const { user, api, dialog } = await openEditor();
  api.failNextMutation({ exitCode: 1, output: ["CONFLICT (content): Merge conflict in a.txt"] });
  api.setOperation(worktree, { kind: "rebase", step: { current: 1, total: 3 }, conflicts: 1, canSkip: true });

  await user.click(dialog.getByRole("button", { name: "Start rebase" }));

  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Interactive rebase" })).not.toBeInTheDocument());
  expect(await screen.findByRole("region", { name: "Operation in progress" })).toHaveTextContent("Rebase in progress");
});

it("says so when the rebase fails without pausing", async () => {
  const { user, api, dialog } = await openEditor();
  api.failNextMutation({ exitCode: 128, output: ["fatal: cannot rebase"] });

  await user.click(dialog.getByRole("button", { name: "Start rebase" }));

  expect(await dialog.findByText(/The rebase failed/)).toBeInTheDocument();
});

it("is reachable from the reword dialog of an older commit", async () => {
  const user = userEvent.setup();
  const api = createStubCoreApi(
    { [worktree]: sampleTab },
    {},
    {
      [worktree]: [
        commitRow({ id: ids[1] as string, subject: "Latest", refs: [{ kind: "head", name: "HEAD" }] }),
        commitRow({ id: ids[0] as string, subject: "Older", timestamp: localTime(2026, 1, 4, 12) }),
      ],
    },
  );
  api.setRebasePlan(worktree, ids[0] as string, plan);
  renderApp({ api, pickFolder: async () => worktree });
  await user.click(screen.getByRole("button", { name: /open folder/i }));
  await screen.findByRole("tab");
  await user.click(screen.getByRole("button", { name: "History" }));
  await screen.findByRole("list", { name: "Commit history" });
  fireEvent.contextMenu(screen.getByText("Older"), { clientX: 10, clientY: 10 });
  await user.click(await screen.findByRole("menuitem", { name: "Reword…" }));

  await user.click(await screen.findByRole("button", { name: "Open the interactive rebase editor" }));

  expect(await screen.findByRole("dialog", { name: "Interactive rebase" })).toBeInTheDocument();
});

it("edits the plan of a rebase that is in progress from the banner", async () => {
  const user = userEvent.setup();
  const api = createStubCoreApi({ [worktree]: sampleTab });
  api.setOperation(worktree, { kind: "rebase", step: { current: 1, total: 2 }, conflicts: 0, canSkip: true });
  api.setRebasePlan(worktree, null, {
    onto: null,
    inProgress: true,
    entries: [{ kind: "line", text: "exec make test" }, commit(2, "Third")],
  });
  renderApp({ api, pickFolder: async () => worktree });
  await user.click(screen.getByRole("button", { name: /open folder/i }));
  await screen.findByRole("tab");

  await user.click(await screen.findByRole("button", { name: "Edit plan" }));
  const dialog = within(await screen.findByRole("dialog", { name: "Interactive rebase" }));
  await user.selectOptions(await dialog.findByLabelText("Action for ccccccc"), "drop");
  await user.click(dialog.getByRole("button", { name: "Update plan" }));

  await waitFor(() => expect(api.appliedPlans[0]?.inProgress).toBe(true));
});
