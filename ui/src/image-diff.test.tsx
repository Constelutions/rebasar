import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { CommitDetail, CoreApi, DiffContent, FileChange, FileDiff, ImageSide } from "./core/api";
import { commitDiffKey, commitKey, createStubCoreApi, diffKey } from "./core/stub";
import { commitRow, localTime, renderApp, sampleTab } from "./test-support";

const worktree = sampleTab.worktreePath;
const commitId = "a".repeat(40);
const path = "assets/logo.png";

function change(kind: FileChange["kind"] = "modified"): FileChange {
  return { path, originalPath: null, kind, added: null, removed: null };
}

function image(overrides: Partial<ImageSide> = {}): ImageSide {
  return { mime: "image/png", bytes: 7373, data: "iVBORw0KGgo=", ...overrides };
}

function imageDiff(content: Extract<DiffContent, { kind: "image" }>): FileDiff {
  return { path, originalPath: null, modeChange: null, content };
}

function detail(kind: FileChange["kind"]): CommitDetail {
  return {
    id: commitId,
    shortId: commitId.slice(0, 7),
    authorName: "Ada Lovelace",
    authorEmail: "ada@example.com",
    authorTimestamp: localTime(2026, 1, 5, 12),
    message: "Change the logo",
    parents: [{ id: "b".repeat(40), shortId: "bbbbbbb", subject: "Before" }],
    files: [change(kind)],
  };
}

async function openCommit(diff: FileDiff, kind: FileChange["kind"] = "modified", wrap?: (api: CoreApi) => CoreApi) {
  const user = userEvent.setup();
  const api = createStubCoreApi(
    { [worktree]: sampleTab },
    {},
    { [worktree]: [commitRow({ id: commitId, subject: "Change the logo" })] },
    {},
    {},
    undefined,
    undefined,
    {
      commitDetails: { [commitKey(commitId, 0)]: detail(kind) },
      commitDiffs: { [commitDiffKey({ commit: commitId, parent: 0, path })]: diff },
    },
  );
  renderApp({ api: wrap?.(api) ?? api, pickFolder: async () => worktree });
  await user.click(screen.getByRole("button", { name: /open folder/i }));
  await screen.findByRole("tab");
  await user.click(screen.getByRole("button", { name: "History" }));
  const history = await screen.findByRole("list", { name: "Commit history" });
  await user.click(within(history).getByText("Change the logo"));
  return { user, api, diff: await screen.findByRole("region", { name: `Diff of ${path}` }) };
}

async function openChanges(diff: FileDiff) {
  const user = userEvent.setup();
  const api = createStubCoreApi(
    { [worktree]: sampleTab },
    { [worktree]: { conflicts: [], staged: [], unstaged: [change()] } },
    {},
    { [diffKey({ list: "unstaged", path })]: diff },
  );
  renderApp({ api, pickFolder: async () => worktree });
  await user.click(screen.getByRole("button", { name: /open folder/i }));
  await screen.findByRole("tab");
  await user.click(screen.getByRole("button", { name: "Changes" }));
  return { user, api, diff: await screen.findByRole("region", { name: `Diff of ${path}` }) };
}

function showPixels(figure: HTMLElement, width: number, height: number) {
  const picture = within(figure).getByRole("img");
  Object.defineProperty(picture, "naturalWidth", { value: width });
  Object.defineProperty(picture, "naturalHeight", { value: height });
  fireEvent.load(picture);
}

it("shows the before and after of a modified image with their sizes and pixel dimensions", async () => {
  const { diff } = await openCommit(
    imageDiff({ kind: "image", old: image({ bytes: 7373 }), new: image({ bytes: 2048, data: "AAAA" }) }),
  );

  const before = within(diff).getByRole("figure", { name: "Before" });
  const after = within(diff).getByRole("figure", { name: "After" });
  showPixels(before, 64, 48);
  showPixels(after, 128, 96);

  expect(within(before).getByRole("img")).toHaveAttribute("src", "data:image/png;base64,iVBORw0KGgo=");
  expect(within(after).getByRole("img")).toHaveAttribute("src", "data:image/png;base64,AAAA");
  await waitFor(() => expect(before).toHaveTextContent("7.2 KB"));
  expect(before).toHaveTextContent("64 × 48 px");
  expect(after).toHaveTextContent("2.0 KB");
  expect(after).toHaveTextContent("128 × 96 px");
});

it("shows only the after of an added image", async () => {
  const { diff } = await openCommit(imageDiff({ kind: "image", old: null, new: image() }), "added");

  expect(within(diff).getByRole("figure", { name: "After" })).toBeInTheDocument();
  expect(within(diff).queryByRole("figure", { name: "Before" })).not.toBeInTheDocument();
});

it("shows only the before of a deleted image", async () => {
  const { diff } = await openCommit(imageDiff({ kind: "image", old: image(), new: null }), "deleted");

  expect(within(diff).getByRole("figure", { name: "Before" })).toBeInTheDocument();
  expect(within(diff).queryByRole("figure", { name: "After" })).not.toBeInTheDocument();
});

it("shows the same preview in the Changes view", async () => {
  const { diff } = await openChanges(imageDiff({ kind: "image", old: image(), new: image({ bytes: 100 }) }));

  expect(within(diff).getByRole("figure", { name: "Before" })).toHaveTextContent("7.2 KB");
  expect(within(diff).getByRole("figure", { name: "After" })).toHaveTextContent("100 B");
});

it("keeps the Binary file line for a file that is not an image", async () => {
  const { diff } = await openCommit(
    { path, originalPath: null, modeChange: null, content: { kind: "binary", oldBytes: 2048, newBytes: 4096 } },
  );

  expect(diff).toHaveTextContent("Binary file. Before: 2.0 KB · After: 4.0 KB");
  expect(within(diff).queryByRole("figure", { name: "Before" })).not.toBeInTheDocument();
});

it("shows the size of an image over the cap with a button to load it", async () => {
  const large = image({ bytes: 6 * 1024 * 1024, data: null });
  const { user, api, diff } = await openCommit(
    imageDiff({ kind: "image", old: null, new: large }),
    "added",
    (stub) => ({
      ...stub,
      commitFileDiff: async (worktreePath, request) =>
        request.loadLarge
          ? imageDiff({ kind: "image", old: null, new: { ...large, data: "AAAA" } })
          : stub.commitFileDiff(worktreePath, request),
    }),
  );

  const after = within(diff).getByRole("figure", { name: "After" });
  expect(after).toHaveTextContent("6.0 MB");
  expect(within(after).queryByRole("img")).not.toBeInTheDocument();
  expect(api.commitDiffRequests[0]?.loadLarge).toBeFalsy();

  await user.click(within(diff).getByRole("button", { name: "Load image" }));

  expect(await within(diff).findByRole("img")).toHaveAttribute("src", "data:image/png;base64,AAAA");
  expect(within(diff).queryByRole("button", { name: "Load image" })).not.toBeInTheDocument();
});

it("asks for the large image through the Changes view as well", async () => {
  const { user, api, diff } = await openChanges(
    imageDiff({ kind: "image", old: null, new: image({ bytes: 6 * 1024 * 1024, data: null }) }),
  );

  await user.click(within(diff).getByRole("button", { name: "Load image" }));

  await waitFor(() => expect(api.diffRequests.at(-1)?.loadLarge).toBe(true));
});

it("does not offer to load an image that already came with its data", async () => {
  const { diff } = await openCommit(imageDiff({ kind: "image", old: image(), new: image() }));

  expect(within(diff).queryByRole("button", { name: "Load image" })).not.toBeInTheDocument();
});
