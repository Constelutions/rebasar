import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { FileChange, OutgoingCommit, WorktreeStatus } from "./core/api";
import { createStubCoreApi } from "./core/stub";
import { renderApp, sampleTab } from "./test-support";

function change(path: string, kind: FileChange["kind"]): FileChange {
  return { path, originalPath: null, kind, added: 1, removed: 0 };
}

function outgoingCommit(shortId: string, subject: string): OutgoingCommit {
  return { id: shortId.padEnd(40, "0"), shortId, subject };
}

const staged: WorktreeStatus = {
  conflicts: [],
  staged: [change("src/api.ts", "modified")],
  unstaged: [change("notes.txt", "untracked")],
};
const nothingStaged: WorktreeStatus = { conflicts: [], staged: [], unstaged: staged.unstaged };

async function openChanges(
  status: WorktreeStatus = staged,
  outgoing: OutgoingCommit[] = [],
) {
  const user = userEvent.setup();
  const api = createStubCoreApi(
    { [sampleTab.worktreePath]: sampleTab },
    { [sampleTab.worktreePath]: status },
  );
  if (outgoing.length > 0) api.setOutgoingCommits(sampleTab.worktreePath, outgoing);
  renderApp({ api, pickFolder: async () => sampleTab.worktreePath });
  await user.click(screen.getByRole("button", { name: /open folder/i }));
  await user.click(screen.getByRole("button", { name: "Changes" }));
  await screen.findByRole("form", { name: "Commit" });
  return { user, api };
}

const subject = () => screen.getByRole("textbox", { name: "Subject" });
const body = () => screen.getByRole("textbox", { name: "Body" });
const chip = (name: string) => screen.getByRole("button", { name });

async function outgoingItems() {
  const region = await screen.findByRole("region", { name: "Outgoing commits" });
  return within(region)
    .queryAllByRole("listitem")
    .map((item) => item.textContent);
}

describe("type chips", () => {
  it("offers feat, fix, refactor, chore, docs and test", async () => {
    await openChanges();

    const chips = within(screen.getByRole("group", { name: "Commit type" })).getAllByRole("button");

    expect(chips.map((button) => button.textContent)).toEqual([
      "feat",
      "fix",
      "refactor",
      "chore",
      "docs",
      "test",
    ]);
  });

  it("prefixes the subject with the chosen type and marks the chip as selected", async () => {
    const { user } = await openChanges();
    await user.type(subject(), "add the composer");

    await user.click(chip("feat"));

    expect(subject()).toHaveValue("feat: add the composer");
    expect(chip("feat")).toHaveAttribute("aria-pressed", "true");
    expect(chip("fix")).toHaveAttribute("aria-pressed", "false");
  });

  it("switches the type while keeping the scope", async () => {
    const { user } = await openChanges();
    await user.type(subject(), "feat(ui): add the composer");

    await user.click(chip("fix"));

    expect(subject()).toHaveValue("fix(ui): add the composer");
  });

  it("removes the prefix when the selected chip is pressed again", async () => {
    const { user } = await openChanges();
    await user.type(subject(), "add the composer");
    await user.click(chip("docs"));

    await user.click(chip("docs"));

    expect(subject()).toHaveValue("add the composer");
    expect(chip("docs")).toHaveAttribute("aria-pressed", "false");
  });

  it("selects the chip for a type that was typed by hand", async () => {
    const { user } = await openChanges();

    await user.type(subject(), "refactor: tidy up");

    expect(chip("refactor")).toHaveAttribute("aria-pressed", "true");
  });
});

describe("subject counter", () => {
  it("counts the characters of the subject against the 72 character limit", async () => {
    const { user } = await openChanges();
    expect(screen.getByText("0 / 72")).toBeInTheDocument();

    await user.type(subject(), "Fix the api");

    expect(screen.getByText("11 / 72")).toBeInTheDocument();
    expect(subject()).toHaveAccessibleDescription("11 / 72");
  });

  it("flags a subject that is too long without blocking the commit", async () => {
    const { user } = await openChanges();

    await user.click(subject());
    await user.paste("x".repeat(80));

    expect(screen.getByText("80 / 72")).toHaveAttribute("data-over-limit", "true");
    expect(screen.getByRole("button", { name: "Commit" })).toBeEnabled();
  });
});

describe("message", () => {
  it("commits the subject followed by the body", async () => {
    const { user, api } = await openChanges();

    await user.type(subject(), "Fix the api");
    await user.type(body(), "It returned nothing.{Enter}Now it does.");
    await user.click(screen.getByRole("button", { name: "Commit" }));

    await screen.findByText("Fix the api", { selector: ".commit-subject" });
    expect(api.commits[0]?.message).toBe("Fix the api\n\nIt returned nothing.\nNow it does.");
    expect(subject()).toHaveValue("");
    expect(body()).toHaveValue("");
  });

  it("needs a subject even when there is a body", async () => {
    const { user } = await openChanges();

    await user.type(body(), "Only a body");

    expect(screen.getByRole("button", { name: "Commit" })).toBeDisabled();
  });
});

describe("amend and sign off", () => {
  it("passes both options to the core", async () => {
    const { user, api } = await openChanges();

    await user.type(subject(), "Fix the api");
    await user.click(screen.getByRole("checkbox", { name: "Amend previous commit" }));
    await user.click(screen.getByRole("checkbox", { name: "Sign off" }));
    await user.click(screen.getByRole("button", { name: "Amend commit" }));

    await screen.findByText("Fix the api", { selector: ".commit-subject" });
    expect(api.commits).toEqual([
      { worktreePath: sampleTab.worktreePath, message: "Fix the api", amend: true, signOff: true },
    ]);
  });

  it("amends without staged files, and without a message to keep the previous one", async () => {
    const { user, api } = await openChanges(nothingStaged);
    expect(screen.getByRole("button", { name: "Commit" })).toBeDisabled();

    await user.click(screen.getByRole("checkbox", { name: "Amend previous commit" }));
    await user.click(screen.getByRole("button", { name: "Amend commit" }));

    await act(async () => {});
    expect(api.commits).toEqual([
      { worktreePath: sampleTab.worktreePath, message: "", amend: true, signOff: false },
    ]);
  });

  it("does not amend a message that has a body but no subject", async () => {
    const { user } = await openChanges(nothingStaged);
    await user.click(screen.getByRole("checkbox", { name: "Amend previous commit" }));

    await user.type(body(), "Only a body");

    expect(screen.getByRole("button", { name: "Amend commit" })).toBeDisabled();
  });

  it("goes back to a plain commit after an amend but keeps signing off", async () => {
    const { user } = await openChanges();
    await user.type(subject(), "Fix the api");
    await user.click(screen.getByRole("checkbox", { name: "Amend previous commit" }));
    await user.click(screen.getByRole("checkbox", { name: "Sign off" }));

    await user.click(screen.getByRole("button", { name: "Amend commit" }));

    await screen.findByText("Fix the api", { selector: ".commit-subject" });
    expect(screen.getByRole("checkbox", { name: "Amend previous commit" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Sign off" })).toBeChecked();
  });
});

describe("outgoing commits", () => {
  it("lists them newest first beside the composer", async () => {
    await openChanges(nothingStaged, [
      outgoingCommit("bbb2222", "Add b"),
      outgoingCommit("aaa1111", "Add a"),
    ]);

    expect(await outgoingItems()).toEqual(["bbb2222Add b", "aaa1111Add a"]);
  });

  it("says so when there is nothing to push", async () => {
    await openChanges(nothingStaged);

    expect(
      within(await screen.findByRole("region", { name: "Outgoing commits" })).getByText(
        "Nothing to push.",
      ),
    ).toBeInTheDocument();
  });

  it("includes the commit about to be created, following the subject as it is typed", async () => {
    const { user } = await openChanges(staged, [outgoingCommit("aaa1111", "Add a")]);

    expect(await outgoingItems()).toEqual(["pending(no subject yet)", "aaa1111Add a"]);

    await user.type(subject(), "Fix the api");

    expect(await outgoingItems()).toEqual(["pendingFix the api", "aaa1111Add a"]);
  });

  it("has no pending commit when nothing is staged", async () => {
    await openChanges(nothingStaged, [outgoingCommit("aaa1111", "Add a")]);

    expect(await outgoingItems()).toEqual(["aaa1111Add a"]);
  });

  it("shows an amend in place of the newest outgoing commit", async () => {
    const { user } = await openChanges(nothingStaged, [
      outgoingCommit("bbb2222", "Add b"),
      outgoingCommit("aaa1111", "Add a"),
    ]);

    await user.click(screen.getByRole("checkbox", { name: "Amend previous commit" }));
    expect(await outgoingItems()).toEqual(["pendingAdd b", "aaa1111Add a"]);

    await user.type(subject(), "Reworded");
    expect(await outgoingItems()).toEqual(["pendingReworded", "aaa1111Add a"]);
  });

  it("lists the new commit as outgoing once it is made", async () => {
    const { user } = await openChanges(staged, [outgoingCommit("aaa1111", "Add a")]);
    await user.type(subject(), "Fix the api");

    await user.click(screen.getByRole("button", { name: "Commit" }));

    await vi.waitFor(() =>
      expect(screen.queryByRole("button", { name: /^Unstage / })).not.toBeInTheDocument(),
    );
    expect(await outgoingItems()).toEqual([expect.stringMatching(/Fix the api$/), "aaa1111Add a"]);
  });

  it("refreshes when the list changes outside the app", async () => {
    const { api } = await openChanges(nothingStaged, [outgoingCommit("aaa1111", "Add a")]);
    expect(await outgoingItems()).toEqual(["aaa1111Add a"]);

    act(() => api.setOutgoingCommits(sampleTab.worktreePath, []));

    expect(
      await within(screen.getByRole("region", { name: "Outgoing commits" })).findByText(
        "Nothing to push.",
      ),
    ).toBeInTheDocument();
  });
});

describe("placement", () => {
  it("is part of Changes: there is no Commit view and no Commit button in the title bar", async () => {
    await openChanges();

    const form = screen.getByRole("form", { name: "Commit" });
    for (const button of screen.getAllByRole("button", { name: /commit/i })) {
      expect(form).toContainElement(button);
    }
    expect(screen.queryByRole("button", { name: "Commit", current: "page" })).toBeNull();
    expect(screen.getByRole("button", { name: "Changes" })).toHaveAttribute("aria-current", "page");
  });
});
