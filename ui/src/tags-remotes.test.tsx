import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { RemoteInfo, TagInfo } from "./core/api";
import { createStubCoreApi } from "./core/stub";
import { renderApp, sampleTab } from "./test-support";

const worktree = sampleTab.worktreePath;

function tag(name: string, annotated = false): TagInfo {
  return { name, annotated, shortId: "abc1234", subject: "Latest" };
}

const origin: RemoteInfo = { name: "origin", url: "https://example.com/app.git", pushUrl: "" };

async function open(tags: TagInfo[] = [tag("v1.0"), tag("v2.0", true)], remotes: RemoteInfo[] = [origin]) {
  const user = userEvent.setup();
  const api = createStubCoreApi({ [worktree]: sampleTab });
  api.setTagsAndRemotes(worktree, tags, remotes);
  renderApp({ api, pickFolder: async () => worktree });
  await user.click(screen.getByRole("button", { name: /open folder/i }));
  await screen.findByRole("tab");
  await user.click(screen.getByRole("button", { name: "Branches" }));
  return { user, api };
}

async function chooseFromMenu(user: ReturnType<typeof userEvent.setup>, subject: string, item: string) {
  await user.click(await screen.findByRole("button", { name: `Options for ${subject}` }));
  await user.click(screen.getByRole("menuitem", { name: item }));
}

it("lists tags as lightweight or annotated", async () => {
  await open();

  const list = await screen.findByRole("list", { name: "Tag list" });

  expect(within(list).getAllByRole("listitem")[0]).toHaveTextContent("v1.0");
  expect(within(list).getAllByRole("listitem")[0]).toHaveTextContent("lightweight");
  expect(within(list).getAllByRole("listitem")[1]).toHaveTextContent("annotated");
});

it("says so when there are no tags or remotes", async () => {
  await open([], []);

  expect(await screen.findByText("No tags.")).toBeInTheDocument();
  expect(screen.getByText("No remotes.")).toBeInTheDocument();
});

it("creates a lightweight tag and an annotated one", async () => {
  const { user, api } = await open([]);
  await screen.findByText("No tags.");

  await user.type(screen.getByLabelText("Tag name"), "v3");
  await user.click(screen.getByRole("button", { name: "Create tag" }));
  await waitFor(() => expect(api.tagRemoteActions).toEqual(["tag:v3"]));

  await user.type(await screen.findByLabelText("Tag name"), "v4");
  await user.type(screen.getByLabelText("Message (makes it annotated)"), "Release four");
  await user.click(screen.getByRole("button", { name: "Create tag" }));
  await waitFor(() => expect(api.tagRemoteActions).toEqual(["tag:v3", "tag:v4:Release four"]));
  expect(await screen.findByText("v4")).toBeInTheDocument();
});

it("pushes a tag to the remote", async () => {
  const { user, api } = await open();

  await user.click(await screen.findByRole("button", { name: "Push tag v1.0 to origin" }));

  await waitFor(() => expect(api.tagRemoteActions).toEqual(["tag-push:v1.0:origin"]));
});

it("deletes a tag that loses nothing straight away", async () => {
  const { user, api } = await open();

  await chooseFromMenu(user, "tag v1.0", "Delete");

  await waitFor(() => expect(api.tagRemoteActions).toEqual(["tag-delete:v1.0"]));
  await waitFor(() => expect(screen.queryByText("v1.0")).not.toBeInTheDocument());
});

it("asks before deleting a tag that is the only reference to commits", async () => {
  const { user, api } = await open([tag("only-me")]);

  await chooseFromMenu(user, "tag only-me", "Delete");
  const dialog = await screen.findByRole("alertdialog", { name: "Delete tag" });

  expect(dialog).toHaveTextContent("2 commits will no longer be reachable");
  expect(api.tagRemoteActions).toEqual([]);
  await user.click(within(dialog).getByRole("button", { name: "Delete" }));
  await waitFor(() => expect(api.tagRemoteActions).toEqual(["tag-delete:only-me"]));
});

it("deletes a tag on the remote and leaves the local one", async () => {
  const { user, api } = await open();

  await chooseFromMenu(user, "tag v1.0", "Delete on origin");

  await waitFor(() => expect(api.tagRemoteActions).toEqual(["tag-delete-remote:v1.0:origin"]));
  expect(screen.getByText("v1.0")).toBeInTheDocument();
});

it("offers no push or remote delete without a remote", async () => {
  await open([tag("v1.0")], []);

  await screen.findByText("v1.0");

  expect(screen.queryByRole("button", { name: /Push tag/ })).not.toBeInTheDocument();
});

it("lists remotes with their addresses", async () => {
  await open([], [origin, { name: "mirror", url: "https://m.example/a.git", pushUrl: "ssh://m.example/a.git" }]);

  const list = await screen.findByRole("list", { name: "Remote list" });

  expect(within(list).getAllByRole("listitem")[1]).toHaveTextContent("https://m.example/a.git");
  expect(within(list).getAllByRole("listitem")[1]).toHaveTextContent("push: ssh://m.example/a.git");
});

it("adds a remote", async () => {
  const { user, api } = await open([], []);
  await screen.findByText("No remotes.");

  await user.type(screen.getByLabelText("Remote name"), "origin");
  await user.type(screen.getByLabelText("Address"), "https://example.com/new.git");
  await user.click(screen.getByRole("button", { name: "Add remote" }));

  await waitFor(() => expect(api.tagRemoteActions).toEqual(["remote-add:origin:https://example.com/new.git"]));
  expect(await screen.findByText("https://example.com/new.git")).toBeInTheDocument();
});

it("renames a remote", async () => {
  const { user, api } = await open();

  await chooseFromMenu(user, "remote origin", "Rename");
  const dialog = await screen.findByRole("dialog", { name: "Rename origin" });
  await user.clear(within(dialog).getByLabelText("New name"));
  await user.type(within(dialog).getByLabelText("New name"), "upstream");
  await user.click(within(dialog).getByRole("button", { name: "Save" }));

  await waitFor(() => expect(api.tagRemoteActions).toEqual(["remote-rename:origin:upstream"]));
});

it("edits the address of a remote", async () => {
  const { user, api } = await open();

  await chooseFromMenu(user, "remote origin", "Edit address");
  const dialog = await screen.findByRole("dialog", { name: "Address of origin" });
  await user.clear(within(dialog).getByLabelText("New address"));
  await user.type(within(dialog).getByLabelText("New address"), "https://other.example/app.git");
  await user.click(within(dialog).getByRole("button", { name: "Save" }));

  await waitFor(() => expect(api.tagRemoteActions).toEqual(["remote-url:origin:https://other.example/app.git"]));
  expect(await screen.findByText("https://other.example/app.git")).toBeInTheDocument();
});

it("removes a remote", async () => {
  const { user, api } = await open();

  await chooseFromMenu(user, "remote origin", "Remove");

  await waitFor(() => expect(api.tagRemoteActions).toEqual(["remote-remove:origin"]));
  expect(await screen.findByText("No remotes.")).toBeInTheDocument();
});

it("says what failed when Git refuses a remote", async () => {
  const { user, api } = await open([], []);
  api.failNextMutation({ exitCode: 3, output: ["error: remote origin already exists."] });
  await screen.findByText("No remotes.");

  await user.type(screen.getByLabelText("Remote name"), "origin");
  await user.type(screen.getByLabelText("Address"), "https://example.com/new.git");
  await user.click(screen.getByRole("button", { name: "Add remote" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("Adding origin failed");
});
