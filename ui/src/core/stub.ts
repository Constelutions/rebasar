import {
  type Assessment,
  type CommitDetail,
  type CommitDiffRequest,
  type CommitOptions,
  type CoreApi,
  type CoreEvent,
  type DiffLine,
  type DiffRequest,
  type Editor,
  type BranchInfo,
  type ConflictFile,
  type ConflictSide,
  type FileChange,
  type FileDiff,
  type FoundRepository,
  type GitHubAuthStatus,
  type GitHubRepository,
  type PullRequestsUnavailable,
  type GitSetup,
  type Group,
  type GitIdentity,
  type Hunk,
  type LineSelection,
  type ChangeList,
  type Head,
  type HistoryRow,
  type RefLabel,
  type RepositoryEntry,
  type RepositoryList,
  type Session,
  type MutationKind,
  type MutationOutcome,
  type MergeMode,
  type OperationInProgress,
  type PullStrategy,
  type RebasePlan,
  type ResetMode,
  type StashInfo,
  type StashPreview,
  type PullRequestDetails,
  type RemoteInfo,
  type TagInfo,
  type WorktreeDetail,
  type SyncStatus,
  type OutgoingCommit,
  type PullRequest,
  type Tab,
  type WorktreeDiffRequest,
  type TokenSource,
  type WorktreeStatus,
  type Settings,
  HISTORY_SHORT_ID_LENGTH,
  defaultSettings,
} from "./api";

export const emptyStatus: WorktreeStatus = { conflicts: [], staged: [], unstaged: [] };

export function diffKey({ list, path }: Pick<DiffRequest, "list" | "path">) {
  return `${list}:${path}`;
}

const ready: GitSetup = { kind: "ready", version: "2.47.1" };

const defaultEditors: Editor[] = [
  { id: "vscode", label: "VS Code", opensFolders: true, available: true, unavailableReason: null },
  { id: "zed", label: "Zed", opensFolders: true, available: true, unavailableReason: null },
];

export interface StubGitHub {
  /** GitHub remote by Worktree path; a Worktree that is not listed has no GitHub remote. */
  remotes?: Record<string, GitHubRepository>;
  /** Who is signed in before the test starts. */
  signedInWith?: TokenSource | null;
  /** The pasted tokens GitHub accepts. */
  validTokens?: string[];
  /** Open pull requests by Worktree path. */
  pullRequests?: Record<string, PullRequest[]>;
}

export function worktreeDiffKey({ commit, path }: Pick<WorktreeDiffRequest, "commit" | "path">) {
  return `${commit}:${path}`;
}

export type CommitActionCall =
  | { kind: "checkout"; commit: string }
  | { kind: "createBranch"; name: string; commit: string }
  | { kind: "createTag"; name: string; commit: string }
  | { kind: "reword"; commit: string; message: string }
  | { kind: "cherryPick"; commit: string }
  | { kind: "revert"; commit: string }
  | { kind: "reset"; commit: string; mode: ResetMode };

export interface MutationFailure {
  exitCode: number;
  /** Written to stderr, as a failing hook would. */
  output: string[];
}

export interface StubCoreState {
  /** What the app restores on launch; its Tabs are known to the stub as Repositories. */
  session?: Session;
  groups?: Group[];
  /** The Repositories the registry already holds, as an earlier run would have left them. */
  registry?: RepositoryEntry[];
  settings?: Settings;
  identity?: GitIdentity;
  /** What every Repository's own Git configuration holds, before anything is saved to it. */
  repositoryIdentity?: GitIdentity;
  /** What the platform layer reports as the editors of this OS; both usable by default. */
  editors?: Editor[];
}

export function commitKey(commit: string, parent: number) {
  return `${commit}:${parent}`;
}

export function commitDiffKey({
  commit,
  parent,
  path,
}: Pick<CommitDiffRequest, "commit" | "parent" | "path">) {
  return `${commitKey(commit, parent)}:${path}`;
}

export interface StubCommits {
  /** What the core reports for a commit read against a parent, keyed by {@link commitKey}. */
  commitDetails?: Record<string, CommitDetail>;
  /** Diffs of files in commits, keyed by {@link commitDiffKey}; a file without one has no content changes. */
  commitDiffs?: Record<string, FileDiff>;
  /** The files that differ from the working tree, keyed by commit id. */
  comparisons?: Record<string, FileChange[]>;
  /** Diffs of compared files, keyed by {@link worktreeDiffKey}. */
  comparisonDiffs?: Record<string, FileDiff>;
}

export interface RecordedCommit extends CommitOptions {
  worktreePath: string;
  message: string;
}

export interface StubCoreApi extends CoreApi {
  /** Replaces what the Worktree reports, as an edit made outside the app would. */
  changeWorktree(path: string, status: WorktreeStatus): void;
  /** Switches the branch of a Worktree outside the app and reports it as a change. */
  checkOut(path: string, head: Head): void;
  /** Reports which Tabs the core has fallen back to polling, as when the watch limit is hit. */
  setPolling(paths: string[]): void;
  /** Replaces the branches the Worktree's Repository lists; by default just the checked-out one. */
  setBranches(path: string, branches: RefLabel[]): void;
  /** Deletes the Repository's folder outside the app; the next listing shows it as missing. */
  loseRepository(path: string): void;
  /** Makes status reads wait until the returned function is called. */
  holdStatusReads(): () => void;
  /** Delivers an event as if the core had emitted it, to drive streaming and progress. */
  emitEvent(event: CoreEvent): void;
  /** Pauses the Worktree in the middle of an operation, or ends it with `null`, as the terminal would. */
  setOperation(path: string, operation: OperationInProgress | null): void;
  /** Everything the UI did with pull requests, such as `create:Title:draft`, `update:#7:Title`, `ready:#7`, `open:url`. */
  readonly pullRequestActions: readonly string[];
  /** The Worktree folders opened in an editor, in order. */
  readonly openedInEditor: readonly { editorId: string; path: string }[];
  /** The files opened in an editor, in order. */
  readonly openedFilesInEditor: readonly { editorId: string; worktreePath: string; file: string }[];
  /** The tags and remotes the Branches view lists. */
  setTagsAndRemotes(path: string, tags: TagInfo[], remotes: RemoteInfo[]): void;
  /** The Worktrees the Worktrees view lists. */
  setWorktreeDetails(path: string, worktrees: WorktreeDetail[]): void;
  /** The stashes the Stashes view lists, newest first, with what each one holds. */
  setStashes(path: string, stashes: { info: StashInfo; preview: StashPreview }[]): void;
  /** How many commits a reset to `commit` would drop, for the confirmation to name. */
  setCommitsDroppedByReset(commit: string, count: number): void;
  /** What the editor gets for a rebase starting at `from`; `null` is the rebase in progress. */
  setRebasePlan(path: string, from: string | null, plan: RebasePlan): void;
  /** What the Conflicts view reads for a conflicted file. */
  setConflictFile(path: string, file: ConflictFile): void;
  /** The branches the Branches view lists; by default just `main`, checked out. */
  setBranchDetails(path: string, branches: BranchInfo[]): void;
  /** What the Worktree reports as ahead and behind, as a fetch from outside the app would. */
  setSyncStatus(path: string, status: Partial<SyncStatus>): void;
  /** What a scan of `folder` finds. */
  setScanResults(folder: string, found: FoundRepository[]): void;
  /** Makes the next stage, unstage or commit fail the way `git` would. */
  failNextMutation(failure: MutationFailure): void;
  readonly watchedWorktrees: ReadonlySet<string>;
  /** The Tabs the core was asked to watch in the background, in that order. */
  readonly backgroundWatched: readonly string[];
  /** The view the user last switched to, as the core remembers it. */
  readonly savedView: string | null;
  readonly cancelledMutations: readonly number[];
  /** Replaces the Worktree's outgoing commits, as a push or fetch made elsewhere would. */
  setOutgoingCommits(path: string, commits: OutgoingCommit[]): void;
  readonly commits: readonly RecordedCommit[];
  readonly assessedMutations: readonly MutationKind[];
  readonly discards: readonly { worktreePath: string; paths: string[] }[];
  /** The lines the UI staged or unstaged, in order. */
  /** The Repositories the UI cloned, initialized or imported, in order. */
  readonly added: readonly { how: "clone" | "init" | "import"; source: string; groupId: string | null }[];
  /** Every commit action the UI ran, in order. */
  readonly commitActions: readonly CommitActionCall[];
  /** Every continue, skip or abort the UI ran, in order. */
  readonly operationActions: readonly ("continue" | "skip" | "abort")[];
  /** Every fetch, pull and push the UI ran, in order. */
  readonly syncActions: readonly string[];
  /** Every branch action the UI ran, such as `merge:topic:noFastForward`, in order. */
  readonly branchActions: readonly string[];
  /** What the UI did to conflicted files, such as `resolve:a.txt`, `side:a.txt:ours`, in order. */
  readonly conflictActions: readonly string[];
  /** The contents each file was resolved with, by path. */
  readonly resolvedContents: ReadonlyMap<string, string>;
  /** Every plan the UI replayed, in order. */
  readonly appliedPlans: readonly RebasePlan[];
  /** Every stash action the UI ran, such as `pop:abc`, `create:message:untracked`, in order. */
  readonly stashActions: readonly string[];
  /** Every Worktree action the UI ran, such as `create:/path:branch:topic`, in order. */
  readonly worktreeActions: readonly string[];
  /** Every tag and remote action the UI ran, such as `tag:v1`, `remote-add:origin:url`, in order. */
  readonly tagRemoteActions: readonly string[];
  readonly stagedLines: readonly { direction: "stage" | "unstage"; selection: LineSelection }[];
  /** Every diff the UI asked for, in order. */
  readonly diffRequests: readonly DiffRequest[];
  /** Every diff of a file in a commit the UI asked for, in order. */
  readonly commitDiffRequests: readonly CommitDiffRequest[];
  /** Every commit the UI asked the detail of, as `[commit, parent]`, in order. */
  readonly commitDetailRequests: readonly (readonly [string, number])[];
  /** The Tab the user last activated, as the core sees it. */
  readonly activeWorktree: string | null;
}

/**
 * A fake core that "knows" the given repositories by folder path and never touches Git.
 * `histories` holds each Worktree's commits, already laid out, newest first; the stub shows all
 * of them whatever the filter, as filtering is the core's business. Diffs are keyed by
 * {@link diffKey}; a file without one has no content changes.
 */
export function createStubCoreApi(
  repositories: Record<string, Tab> = {},
  statuses: Record<string, WorktreeStatus> = {},
  histories: Record<string, HistoryRow[]> = {},
  diffs: Record<string, FileDiff> = {},
  github: StubGitHub = {},
  gitSetup: GitSetup = ready,
  state: StubCoreState = {},
  { commitDetails = {}, commitDiffs = {}, comparisons = {}, comparisonDiffs = {} }: StubCommits = {},
): StubCoreApi {
  const handlers = new Set<(event: CoreEvent) => void>();
  const current = new Map(Object.entries(statuses));
  const tabs = new Map(Object.entries(repositories));
  const watched = new Set<string>();
  const branches = new Map<string, RefLabel[]>();
  const currentDiffs = new Map(Object.entries(diffs));
  const diffRequests: DiffRequest[] = [];
  const commitDiffRequests: CommitDiffRequest[] = [];
  const commitDetailRequests: (readonly [string, number])[] = [];
  const cancelled: number[] = [];
  const commits: RecordedCommit[] = [];
  const outgoing = new Map<string, OutgoingCommit[]>();
  const failures: MutationFailure[] = [];
  const assessed: MutationKind[] = [];
  const discards: { worktreePath: string; paths: string[] }[] = [];
  const added: { how: "clone" | "init" | "import"; source: string; groupId: string | null }[] = [];
  const scanResults = new Map<string, FoundRepository[]>();
  const commitActions: CommitActionCall[] = [];
  const operations = new Map<string, OperationInProgress>();
  const operationActions: ("continue" | "skip" | "abort")[] = [];
  const syncStatuses = new Map<string, SyncStatus>();
  const rememberedPulls = new Set<string>();
  const syncActions: string[] = [];
  const branchDetails = new Map<string, BranchInfo[]>();
  const branchActions: string[] = [];
  const conflictFiles = new Map<string, ConflictFile>();
  const conflictActions: string[] = [];
  const resolvedContents = new Map<string, string>();
  const rebasePlans = new Map<string, RebasePlan>();
  const appliedPlans: RebasePlan[] = [];
  const resetDrops = new Map<string, number>();
  const stashLists = new Map<string, { info: StashInfo; preview: StashPreview }[]>();
  const stashActions: string[] = [];
  const worktreeLists = new Map<string, WorktreeDetail[]>();
  const worktreeActions: string[] = [];
  const tagLists = new Map<string, TagInfo[]>();
  const remoteLists = new Map<string, RemoteInfo[]>();
  const tagRemoteActions: string[] = [];
  const pullRequestActions: string[] = [];
  const openedInEditor: { editorId: string; path: string }[] = [];
  const openedFilesInEditor: { editorId: string; worktreePath: string; file: string }[] = [];
  const pullRequestBodies = new Map<number, string>();
  let nextPullRequest = 100;
  const stagedLines: { direction: "stage" | "unstage"; selection: LineSelection }[] = [];
  let nextMutationId = 1;
  const backgroundWatched: string[] = [];
  const session = state.session ?? { tabs: [], active: null, view: null };
  const groups = [...(state.groups ?? [])];
  const registry = (state.registry ?? []).map((entry) => ({ ...entry }));
  const lost = new Set<string>();
  const openTabs = new Map(session.tabs.map((tab) => [tab.worktreePath, tab]));
  let nextGroup = groups.length;
  let savedView: string | null = null;
  let settings = state.settings ?? defaultSettings;
  let identity = state.identity ?? { name: null, email: null };
  const repositoryIdentities = new Map<string, GitIdentity>();
  const emit = (event: CoreEvent) => handlers.forEach((handler) => handler(event));
  let active: string | null = null;
  let held: Promise<void> | null = null;

  function known(path: string): Tab {
    const tab = tabs.get(path);
    if (!tab) {
      throw { kind: "notARepository", path };
    }
    return tab;
  }
  const statusOf = (path: string) => current.get(path) ?? emptyStatus;

  function mutate(
    path: string,
    title: string,
    change: (status: WorktreeStatus) => WorktreeStatus,
  ): MutationOutcome {
    const mutationId = nextMutationId++;
    emit({
      type: "mutationQueued",
      mutation: { id: mutationId, worktreePath: path, title, command: `git ${title.toLowerCase()}` },
    });
    emit({ type: "mutationStarted", mutationId });

    const failure = failures.shift();
    let outcome: MutationOutcome = { kind: "succeeded" };
    if (failure) {
      for (const text of failure.output) {
        emit({ type: "mutationOutput", mutationId, stream: "stderr", text, transient: false });
      }
      outcome = { kind: "failed", exitCode: failure.exitCode };
    } else {
      current.set(path, change(statusOf(path)));
    }

    emit({ type: "mutationFinished", mutationId, outcome });
    if (outcome.kind === "succeeded") emit({ type: "worktreeChanged", worktreePath: path });
    return outcome;
  }

  let source: TokenSource | null = github.signedInWith ?? null;
  const authStatus = (): GitHubAuthStatus => ({ source });
  const remoteUrl = (path: string) => {
    const remote = github.remotes?.[path];
    return remote ? `https://github.com/${remote.owner}/${remote.name}.git` : null;
  };
  const noRemotes = (): PullRequestsUnavailable => ({
    kind: "pullRequestsUnavailable",
    reason: { kind: "noRemotes" },
    message: "This Repository has no remotes.",
    url: null,
    hint: "Add the GitHub remote with `git remote add origin <url>`.",
  });
  const noToken = (url: string | null): PullRequestsUnavailable => ({
    kind: "pullRequestsUnavailable",
    reason: { kind: "noToken" },
    message: "You are not signed in to GitHub.",
    url,
    hint: "Run `gh auth login`, or paste a personal access token.",
  });

  for (const tab of session.tabs) tabs.set(tab.worktreePath, tab);

  function repositoryAt(path: string): RepositoryEntry {
    const entry = registry.find((candidate) => candidate.path === path);
    if (!entry) throw { kind: "repositoryNotFound", path };
    return entry;
  }

  function closeTabsOf(entry: RepositoryEntry) {
    for (const worktree of entry.worktrees) {
      if (openTabs.delete(worktree.path)) {
        emit({ type: "tabClosed", worktreePath: worktree.path });
      }
    }
  }

  function finishOperation(path: string, action: "continue" | "skip" | "abort"): MutationOutcome {
    operationActions.push(action);
    const operation = operations.get(path);
    const title = `${action[0]?.toUpperCase()}${action.slice(1)} ${operation?.kind ?? "operation"}`;
    return mutate(path, title, (status) => {
      operations.delete(path);
      return status;
    });
  }

  function resolveConflict(path: string, file: string): MutationOutcome {
    return mutate(path, `Mark ${file} resolved`, (status) => {
      const resolved = status.conflicts.find((change) => change.path === file);
      return {
        ...status,
        conflicts: status.conflicts.filter((change) => change.path !== file),
        staged: resolved ? [...status.staged, { ...resolved, kind: "modified" }] : status.staged,
      };
    });
  }

  function branchesOf(path: string): BranchInfo[] {
    return branchDetails.get(path) ?? [{ ...localBranch("main"), current: true }];
  }

  function changeBranches(
    path: string,
    title: string,
    change: (list: BranchInfo[]) => BranchInfo[],
  ): MutationOutcome {
    return mutate(path, title, (status) => {
      branchDetails.set(path, change(branchesOf(path)));
      return status;
    });
  }

  function branchNameOf(path: string): string {
    const head = tabs.get(path)?.head;
    return head?.kind === "branch" ? head.name : "";
  }

  function detailsOf(pr: PullRequest): PullRequestDetails {
    return {
      number: pr.number,
      title: pr.title,
      body: pullRequestBodies.get(pr.number) ?? "",
      url: pr.url,
      isDraft: pr.isDraft,
    };
  }

  function syncOf(path: string): SyncStatus {
    return (
      syncStatuses.get(path) ?? { branch: "main", upstream: "origin/main", ahead: 0, behind: 0 }
    );
  }

  function addRepository(path: string, name: string, groupId: string | null): Tab {
    if (groupId !== null) groupIndex(groupId);
    const tab: Tab = { repositoryName: name, worktreePath: path, head: { kind: "branch", name: "main" } };
    tabs.set(path, tab);
    openTabs.set(path, tab);
    registry.push({
      path,
      name,
      groupId,
      missing: false,
      worktrees: [{ path, main: true, head: tab.head }],
    });
    emit({ type: "tabOpened", tab });
    return tab;
  }

  function validName(name: string): string {
    const trimmed = name.trim();
    if (trimmed === "") throw { kind: "invalidGroupName" };
    return trimmed;
  }

  function groupIndex(id: string): number {
    const index = groups.findIndex((group) => group.id === id);
    if (index < 0) throw { kind: "groupNotFound", id };
    return index;
  }

  return {
    async openFolder(path) {
      const tab = known(path);
      openTabs.set(path, tab);
      if (!registry.some((entry) => entry.worktrees.some((worktree) => worktree.path === path))) {
        registry.push({
          path,
          name: tab.repositoryName,
          groupId: null,
          missing: false,
          worktrees: [{ path, main: true, head: tab.head }],
        });
      }
      emit({ type: "tabOpened", tab });
      return tab;
    },
    async worktreeStatus(path) {
      const snapshot = statusOf(path);
      await held;
      return snapshot;
    },
    async fileDiff(_path, request) {
      diffRequests.push(request);
      return (
        currentDiffs.get(diffKey(request)) ?? {
          path: request.path,
          originalPath: request.originalPath,
          modeChange: null,
          content: { kind: "text", hunks: [] },
        }
      );
    },
    async watchWorktree(path) {
      watched.add(path);
    },
    async historyPage(worktreePath, offset, limit) {
      const rows = histories[worktreePath] ?? [];
      return {
        offset,
        rows: rows.slice(offset, offset + limit),
        hasMore: rows.length > offset + limit,
      };
    },
    async historyCount(worktreePath) {
      const total = (histories[worktreePath] ?? []).length;
      return { matching: total, total };
    },
    async commitDetail(_worktreePath, commit, parent) {
      commitDetailRequests.push([commit, parent]);
      const detail = commitDetails[commitKey(commit, parent)];
      if (!detail) {
        throw { kind: "unexpected", message: `commit ${commit} has no parent number ${parent}` };
      }
      return detail;
    },
    async commitFileDiff(_worktreePath, request) {
      commitDiffRequests.push(request);
      return (
        commitDiffs[commitDiffKey(request)] ?? {
          path: request.path,
          originalPath: request.originalPath,
          modeChange: null,
          content: { kind: "text", hunks: [] },
        }
      );
    },
    async findCommits(worktreePath, query, limit) {
      const needle = query.trim().toLowerCase();
      const rows = histories[worktreePath] ?? [];
      const byHash = isHashPrefix(needle) ? rows.filter((row) => row.id.startsWith(needle)) : [];
      const byMessage = rows.filter(
        (row) => !byHash.includes(row) && row.subject.toLowerCase().includes(needle),
      );
      return [...byHash, ...byMessage].slice(0, limit).map((row) => ({
        id: row.id,
        shortId: row.shortId,
        subject: row.subject,
        authorName: row.authorName,
        timestamp: row.timestamp,
      }));
    },
    async listBranches(worktreePath) {
      const head = known(worktreePath).head;
      return (
        branches.get(worktreePath) ??
        (head.kind === "branch" ? [{ kind: "localBranch", name: head.name }] : [])
      );
    },
    async restoreSession() {
      return session;
    },
    async watchBackgroundTab(path) {
      known(path);
      watched.add(path);
      backgroundWatched.push(path);
    },
    async saveView(view) {
      savedView = view;
    },
    async listRepositories(): Promise<RepositoryList> {
      const entries = registry.map((entry) => {
        if (!lost.has(entry.path)) return entry;
        closeTabsOf(entry);
        return { ...entry, missing: true, worktrees: [] };
      });
      return { groups: [...groups], repositories: entries.map((entry) => ({ ...entry })) };
    },
    async createGroup(name) {
      const group = { id: `group-${++nextGroup}`, name: validName(name) };
      groups.push(group);
      return group;
    },
    async renameGroup(id, name) {
      groups[groupIndex(id)] = { id, name: validName(name) };
    },
    async moveGroup(id, index) {
      const group = groups.splice(groupIndex(id), 1)[0]!;
      groups.splice(Math.min(index, groups.length), 0, group);
    },
    async moveRepository(path, groupId) {
      const entry = repositoryAt(path);
      if (groupId !== null) groupIndex(groupId);
      entry.groupId = groupId;
    },
    async locateRepository(path, newPath) {
      const entry = repositoryAt(path);
      const tab = known(newPath);
      closeTabsOf(entry);
      lost.delete(path);
      entry.path = newPath;
      entry.name = tab.repositoryName;
      entry.missing = false;
      entry.worktrees = [{ path: newPath, main: true, head: tab.head }];
    },
    async currentPullRequest(path) {
      const branch = branchNameOf(path);
      const found = (github.pullRequests?.[path] ?? []).find((pr) => pr.headBranch === branch);
      return found ? detailsOf(found) : null;
    },
    async createPullRequest(path, title, body, draft) {
      if (source === null) throw noToken(remoteUrl(path));
      pullRequestActions.push(`create:${title}${draft ? ":draft" : ""}`);
      const created: PullRequest = {
        number: nextPullRequest++,
        title,
        url: `https://github.com/acme/widgets/pull/${nextPullRequest - 1}`,
        author: "me",
        headBranch: branchNameOf(path),
        baseBranch: "main",
        isDraft: draft,
        checks: "none",
        review: "none",
      };
      pullRequestBodies.set(created.number, body);
      github.pullRequests = { ...github.pullRequests, [path]: [created, ...(github.pullRequests?.[path] ?? [])] };
      return detailsOf(created);
    },
    async updatePullRequest(path, number, title, body) {
      pullRequestActions.push(`update:#${number}:${title}`);
      pullRequestBodies.set(number, body);
      const list = (github.pullRequests?.[path] ?? []).map((pr) => (pr.number === number ? { ...pr, title } : pr));
      github.pullRequests = { ...github.pullRequests, [path]: list };
      return detailsOf(list.find((pr) => pr.number === number) as PullRequest);
    },
    async markPullRequestReady(path, number) {
      pullRequestActions.push(`ready:#${number}`);
      const list = (github.pullRequests?.[path] ?? []).map((pr) => (pr.number === number ? { ...pr, isDraft: false } : pr));
      github.pullRequests = { ...github.pullRequests, [path]: list };
      return detailsOf(list.find((pr) => pr.number === number) as PullRequest);
    },
    async openInBrowser(url) {
      pullRequestActions.push(`open:${url}`);
    },
    async listEditors() {
      return state.editors ?? defaultEditors;
    },
    async openInEditor(editorId, path) {
      openedInEditor.push({ editorId, path });
    },
    async openFileInEditor(editorId, worktreePath, file) {
      openedFilesInEditor.push({ editorId, worktreePath, file });
    },
    async listTags(path) {
      return tagLists.get(path) ?? [];
    },
    async createTagHere(path, name, message) {
      tagRemoteActions.push(`tag:${name}${message ? `:${message}` : ""}`);
      return mutate(path, `Create tag ${name}`, (status) => {
        tagLists.set(path, [
          ...(tagLists.get(path) ?? []),
          { name, annotated: message !== null, shortId: "abc1234", subject: "Latest" },
        ]);
        return status;
      });
    },
    async deleteTag(path, name) {
      tagRemoteActions.push(`tag-delete:${name}`);
      return mutate(path, `Delete tag ${name}`, (status) => {
        tagLists.set(path, (tagLists.get(path) ?? []).filter((tag) => tag.name !== name));
        return status;
      });
    },
    async pushTag(path, name, remote) {
      tagRemoteActions.push(`tag-push:${name}:${remote}`);
      return mutate(path, `Push tag ${name}`, (status) => status);
    },
    async deleteRemoteTag(path, name, remote) {
      tagRemoteActions.push(`tag-delete-remote:${name}:${remote}`);
      return mutate(path, `Delete tag ${name} on ${remote}`, (status) => status);
    },
    async listRemotes(path) {
      return remoteLists.get(path) ?? [];
    },
    async addRemote(path, name, url) {
      tagRemoteActions.push(`remote-add:${name}:${url}`);
      return mutate(path, `Add remote ${name}`, (status) => {
        remoteLists.set(path, [...(remoteLists.get(path) ?? []), { name, url, pushUrl: "" }]);
        return status;
      });
    },
    async renameRemote(path, name, newName) {
      tagRemoteActions.push(`remote-rename:${name}:${newName}`);
      return mutate(path, `Rename remote ${name}`, (status) => {
        remoteLists.set(
          path,
          (remoteLists.get(path) ?? []).map((remote) => (remote.name === name ? { ...remote, name: newName } : remote)),
        );
        return status;
      });
    },
    async setRemoteUrl(path, name, url) {
      tagRemoteActions.push(`remote-url:${name}:${url}`);
      return mutate(path, `Change the address of ${name}`, (status) => {
        remoteLists.set(
          path,
          (remoteLists.get(path) ?? []).map((remote) => (remote.name === name ? { ...remote, url } : remote)),
        );
        return status;
      });
    },
    async removeRemote(path, name) {
      tagRemoteActions.push(`remote-remove:${name}`);
      return mutate(path, `Remove remote ${name}`, (status) => {
        remoteLists.set(path, (remoteLists.get(path) ?? []).filter((remote) => remote.name !== name));
        return status;
      });
    },
    async listWorktreeDetails(path) {
      return (
        worktreeLists.get(path) ?? [
          { path, main: true, head: { kind: "branch", name: "main" }, dirty: false, current: true },
        ]
      );
    },
    async createWorktree(path, target, from, newBranch) {
      const start = from.kind === "branch" ? `branch:${from.name}` : `commit:${from.id}`;
      worktreeActions.push(`create:${target}:${start}${newBranch ? `:new:${newBranch}` : ""}`);
      return mutate(path, `Add worktree ${target}`, (status) => {
        const list = worktreeLists.get(path) ?? [];
        const head: WorktreeDetail["head"] = newBranch
          ? { kind: "branch", name: newBranch }
          : from.kind === "branch"
            ? { kind: "branch", name: from.name }
            : { kind: "detached", commit: from.id.slice(0, 7) };
        worktreeLists.set(path, [...list, { path: target, main: false, head, dirty: false, current: false }]);
        return status;
      });
    },
    async removeWorktree(path, target, force) {
      worktreeActions.push(`remove:${target}${force ? ":force" : ""}`);
      return mutate(path, `Remove worktree ${target}`, (status) => {
        worktreeLists.set(path, (worktreeLists.get(path) ?? []).filter((entry) => entry.path !== target));
        return status;
      });
    },
    async pruneWorktrees(path) {
      worktreeActions.push("prune");
      return mutate(path, "Prune worktrees", (status) => status);
    },
    async listStashes(path) {
      return (stashLists.get(path) ?? []).map(({ info }) => info);
    },
    async stashPreview(path, stash) {
      const found = (stashLists.get(path) ?? []).find(({ info }) => info.id === stash);
      if (!found) throw { kind: "unexpected", message: "that stash no longer exists" };
      return found.preview;
    },
    async stashChanges(path, message, includeUntracked) {
      stashActions.push(`create:${message ?? ""}${includeUntracked ? ":untracked" : ""}`);
      return mutate(path, "Stash changes", (status) => {
        const info: StashInfo = {
          id: String(stashLists.get(path)?.length ?? 0).padStart(40, "9"),
          shortId: "9999999",
          message: message ? `On main: ${message}` : "WIP on main: 1234567 Latest",
          branch: "main",
          timestamp: 1_700_000_000,
        };
        stashLists.set(path, [
          { info, preview: { files: [...status.staged, ...status.unstaged], untracked: [] } },
          ...(stashLists.get(path) ?? []),
        ]);
        return { ...status, staged: [], unstaged: [] };
      });
    },
    async applyStash(path, stash) {
      stashActions.push(`apply:${stash}`);
      return mutate(path, "Apply stash", (status) => status);
    },
    async popStash(path, stash) {
      stashActions.push(`pop:${stash}`);
      return mutate(path, "Pop stash", (status) => {
        stashLists.set(path, (stashLists.get(path) ?? []).filter(({ info }) => info.id !== stash));
        return status;
      });
    },
    async dropStash(path, stash) {
      stashActions.push(`drop:${stash}`);
      return mutate(path, "Drop stash", (status) => {
        stashLists.set(path, (stashLists.get(path) ?? []).filter(({ info }) => info.id !== stash));
        return status;
      });
    },
    async cherryPickCommit(path, commit) {
      commitActions.push({ kind: "cherryPick", commit });
      return mutate(path, `Cherry-pick ${commit.slice(0, HISTORY_SHORT_ID_LENGTH)}`, (status) => status);
    },
    async revertCommit(path, commit) {
      commitActions.push({ kind: "revert", commit });
      return mutate(path, `Revert ${commit.slice(0, HISTORY_SHORT_ID_LENGTH)}`, (status) => status);
    },
    async resetToCommit(path, commit, mode) {
      commitActions.push({ kind: "reset", commit, mode });
      return mutate(path, `Reset ${mode} to ${commit.slice(0, HISTORY_SHORT_ID_LENGTH)}`, (status) => status);
    },
    async rebasePlan(path, from) {
      const found = rebasePlans.get(`${path}\0${from ?? ""}`);
      if (!found) throw { kind: "unexpected", message: "no plan for that commit" };
      return found;
    },
    async applyRebasePlan(path, plan) {
      appliedPlans.push(plan);
      return mutate(path, "Interactive rebase", (status) => status);
    },
    async conflictFile(path, file) {
      const found = conflictFiles.get(`${path}\0${file}`);
      if (!found) throw { kind: "unexpected", message: `${file} is not in conflict` };
      return found;
    },
    async resolveConflictFile(path, file, contents) {
      conflictActions.push(`resolve:${file}`);
      resolvedContents.set(file, contents);
      return resolveConflict(path, file);
    },
    async resolveConflictWithSide(path, file, side: ConflictSide) {
      conflictActions.push(`side:${file}:${side}`);
      return resolveConflict(path, file);
    },
    async openMergeTool(path, file) {
      conflictActions.push(`tool:${file}`);
      return mutate(path, `Merge tool for ${file}`, (status) => status);
    },
    async listBranchDetails(path) {
      return branchesOf(path).map((branch) => ({ ...branch }));
    },
    async createBranchHere(path, name, switchTo) {
      branchActions.push(`create:${name}${switchTo ? ":switch" : ""}`);
      return changeBranches(path, `Create branch ${name}`, (list) => [
        ...list.map((branch) => (switchTo ? { ...branch, current: false } : branch)),
        { ...localBranch(name), current: switchTo },
      ]);
    },
    async checkoutBranch(path, name, remote) {
      branchActions.push(`checkout:${name}`);
      const local = remote ? name.slice(name.indexOf("/") + 1) : name;
      return changeBranches(path, `Check out ${name}`, (list) => {
        const exists = list.some((branch) => branch.kind === "local" && branch.name === local);
        const withLocal = exists ? list : [...list, { ...localBranch(local), upstream: name }];
        return withLocal.map((branch) => ({
          ...branch,
          current: branch.kind === "local" && branch.name === local,
        }));
      });
    },
    async renameBranch(path, name, newName) {
      branchActions.push(`rename:${name}:${newName}`);
      return changeBranches(path, `Rename branch ${name}`, (list) =>
        list.map((branch) =>
          branch.kind === "local" && branch.name === name ? { ...branch, name: newName } : branch,
        ),
      );
    },
    async deleteBranch(path, name) {
      branchActions.push(`delete:${name}`);
      return changeBranches(path, `Delete branch ${name}`, (list) =>
        list.filter((branch) => !(branch.kind === "local" && branch.name === name)),
      );
    },
    async deleteRemoteBranch(path, remote, name) {
      branchActions.push(`delete-remote:${remote}:${name}`);
      return changeBranches(path, `Delete branch ${name} on ${remote}`, (list) =>
        list.filter((branch) => !(branch.kind === "remote" && branch.name === `${remote}/${name}`)),
      );
    },
    async setBranchUpstream(path, name, upstream) {
      branchActions.push(`upstream:${name}:${upstream ?? ""}`);
      return changeBranches(path, `Track ${upstream ?? "nothing"} from ${name}`, (list) =>
        list.map((branch) =>
          branch.kind === "local" && branch.name === name ? { ...branch, upstream } : branch,
        ),
      );
    },
    async mergeBranch(path, branch, mode: MergeMode) {
      branchActions.push(`merge:${branch}:${mode}`);
      return mutate(path, `Merge ${branch}`, (status) => status);
    },
    async rebaseOnto(path, onto) {
      branchActions.push(`rebase:${onto}`);
      return mutate(path, `Rebase onto ${onto}`, (status) => status);
    },
    async syncStatus(path) {
      return syncOf(path);
    },
    async fetchRemotes(path) {
      syncActions.push("fetch");
      return mutate(path, "Fetch", (status) => status);
    },
    async pullNeedsStrategy(path) {
      const sync = syncOf(path);
      return sync.ahead > 0 && sync.behind > 0 && !rememberedPulls.has(path);
    },
    async pull(path, strategy, remember) {
      syncActions.push(`pull${strategy ? `:${strategy}` : ""}${remember ? ":remember" : ""}`);
      if (remember) rememberedPulls.add(path);
      return mutate(path, "Pull", (status) => status);
    },
    async push(path, force) {
      syncActions.push(force ? "forcePush" : "push");
      return mutate(path, force ? "Force push" : "Push", (status) => {
        syncStatuses.set(path, { ...syncOf(path), ahead: 0 });
        return status;
      });
    },
    async operationInProgress(path) {
      return operations.get(path) ?? null;
    },
    async continueOperation(path) {
      return finishOperation(path, "continue");
    },
    async skipOperation(path) {
      return finishOperation(path, "skip");
    },
    async abortOperation(path) {
      return finishOperation(path, "abort");
    },
    async checkoutCommit(path, commit) {
      commitActions.push({ kind: "checkout", commit });
      return mutate(path, `Check out ${commit.slice(0, HISTORY_SHORT_ID_LENGTH)}`, (status) => status);
    },
    async createBranch(path, name, commit) {
      commitActions.push({ kind: "createBranch", name, commit });
      return mutate(path, `Create branch ${name}`, (status) => status);
    },
    async createTag(path, name, commit) {
      commitActions.push({ kind: "createTag", name, commit });
      return mutate(path, `Create tag ${name}`, (status) => status);
    },
    async rewordLatestCommit(path, commit, message) {
      commitActions.push({ kind: "reword", commit, message });
      return mutate(path, `Reword ${commit.slice(0, HISTORY_SHORT_ID_LENGTH)}`, (status) => status);
    },
    async compareWithWorktree(_worktreePath, commit) {
      return comparisons[commit] ?? [];
    },
    async compareFileDiff(_worktreePath, request) {
      return (
        comparisonDiffs[worktreeDiffKey(request)] ?? {
          path: request.path,
          originalPath: null,
          modeChange: null,
          content: { kind: "text", hunks: [] },
        }
      );
    },
    async cloneRepository(url, parent, groupId) {
      if (url.includes("unreachable")) {
        throw { kind: "gitFailed", message: "Could not reach the server. Check the URL and your network connection." };
      }
      added.push({ how: "clone", source: url, groupId });
      const name = lastSegment(url.replace(/\/+$/, "").replace(/\.git$/, ""));
      return addRepository(`${parent}/${name}`, name, groupId);
    },
    async initRepository(folder, groupId) {
      if (registry.some((entry) => entry.path === folder)) {
        throw { kind: "alreadyARepository", path: folder };
      }
      added.push({ how: "init", source: folder, groupId });
      return addRepository(folder, lastSegment(folder), groupId);
    },
    async scanFolder(parent) {
      return scanResults.get(parent) ?? [];
    },
    async importRepositories(paths, groupId) {
      for (const path of paths) {
        added.push({ how: "import", source: path, groupId });
        registry.push({
          path,
          name: lastSegment(path),
          groupId,
          missing: false,
          worktrees: [],
        });
      }
    },
    async removeRepository(path) {
      const entry = repositoryAt(path);
      closeTabsOf(entry);
      registry.splice(registry.indexOf(entry), 1);
    },
    async activateTab(path) {
      known(path);
      watched.add(path);
      active = path;
    },
    async closeTab(path) {
      watched.delete(path);
      if (openTabs.delete(path)) emit({ type: "tabClosed", worktreePath: path });
    },
    async refreshTab(path) {
      return known(path);
    },
    async githubRemote(path) {
      return github.remotes?.[path] ?? null;
    },
    async githubAuthStatus() {
      return authStatus();
    },
    async signInToGitHub(token) {
      if (!github.validTokens?.includes(token.trim())) {
        throw { kind: "githubTokenRejected" };
      }
      source ??= "personalAccessToken";
      return authStatus();
    },
    async signOutOfGitHub() {
      if (source === "personalAccessToken") source = null;
      return authStatus();
    },
    async pullRequests(path) {
      if (!github.remotes?.[path]) throw noRemotes();
      if (source === null) throw noToken(remoteUrl(path));
      return github.pullRequests?.[path] ?? [];
    },
    async appInfo() {
      return { version: "0.0.0-test" };
    },
    async checkGit() {
      return gitSetup;
    },
    async stageLines(path, selection) {
      stagedLines.push({ direction: "stage", selection });
      return mutate(path, linesTitle("Stage", selection), (status) => {
        const left = takeLines(currentDiffs, "unstaged", selection);
        addLines(currentDiffs, "staged", selection);
        const file = status.unstaged.find((candidate) => candidate.path === selection.path);
        if (!file) return status;
        return {
          ...status,
          staged: status.staged.some((candidate) => candidate.path === file.path)
            ? status.staged
            : [...status.staged, asStaged(file)],
          unstaged: left ? status.unstaged : status.unstaged.filter((other) => other !== file),
        };
      });
    },
    async unstageLines(path, selection) {
      stagedLines.push({ direction: "unstage", selection });
      return mutate(path, linesTitle("Unstage", selection), (status) => {
        const left = takeLines(currentDiffs, "staged", selection);
        addLines(currentDiffs, "unstaged", selection);
        const file = status.staged.find((candidate) => candidate.path === selection.path);
        if (!file) return status;
        return {
          ...status,
          staged: left ? status.staged : status.staged.filter((other) => other !== file),
          unstaged: status.unstaged.some((candidate) => candidate.path === file.path)
            ? status.unstaged
            : [...status.unstaged, asUnstaged(file)],
        };
      });
    },
    async stageFiles(path, paths) {
      return mutate(path, titleFor("Stage", paths), (status) => ({
        ...status,
        staged: [
          ...status.staged,
          ...status.unstaged.filter((file) => paths.includes(file.path)).map(asStaged),
        ],
        unstaged: status.unstaged.filter((file) => !paths.includes(file.path)),
      }));
    },
    async unstageFiles(path, paths) {
      return mutate(path, titleFor("Unstage", paths), (status) => ({
        ...status,
        staged: status.staged.filter((file) => !paths.includes(file.path)),
        unstaged: [
          ...status.unstaged,
          ...status.staged.filter((file) => paths.includes(file.path)).map(asUnstaged),
        ],
      }));
    },
    async commit(path, message, options) {
      if (statusOf(path).staged.length === 0 && !options.amend) {
        failures.unshift({ exitCode: 1, output: ["nothing to commit"] });
      }
      return mutate(path, options.amend ? "Amend commit" : "Commit", (status) => {
        commits.push({ worktreePath: path, message, ...options });
        const existing = outgoing.get(path) ?? [];
        const replaced = options.amend ? existing.slice(0, 1) : [];
        const subject = message.split("\n")[0] || replaced[0]?.subject || "";
        const id = `commit${commits.length}`.padEnd(40, "0");
        outgoing.set(path, [
          { id, shortId: id.slice(0, 7), subject },
          ...existing.slice(replaced.length),
        ]);
        return { ...status, staged: [] };
      });
    },
    async outgoingCommits(path) {
      return outgoing.get(path) ?? [];
    },
    async assessMutation(path, kind) {
      assessed.push(kind);
      if (kind.kind === "deleteTag") {
        return kind.name.startsWith("only-")
          ? { kind: "destructive", loss: { files: [], commits: 2, unpushedCommits: 2, commitList: [] } }
          : { kind: "safe" };
      }
      if (kind.kind === "deleteRemoteTag") return { kind: "safe" };
      if (kind.kind === "removeWorktree") {
        const found = (worktreeLists.get(path) ?? []).find((entry) => entry.path === kind.path);
        return found?.dirty
          ? {
              kind: "destructive",
              loss: {
                files: [{ path: "unsaved.ts", originalPath: null, kind: "modified", added: 1, removed: 0 }],
                commits: 0,
                unpushedCommits: 0,
                commitList: [],
              },
            }
          : { kind: "safe" };
      }
      if (kind.kind === "dropStash") {
        const found = (stashLists.get(path) ?? []).find(({ info }) => info.id === kind.stash);
        return found
          ? { kind: "destructive", loss: { files: found.preview.files, commits: 0, unpushedCommits: 0, commitList: [] } }
          : { kind: "safe" };
      }
      if (kind.kind === "reset") {
        const status = statusOf(path);
        const files = kind.mode === "hard" ? [...status.staged, ...status.unstaged] : [];
        const commits = resetDrops.get(kind.commit) ?? 0;
        return files.length === 0 && commits === 0
          ? { kind: "safe" }
          : { kind: "destructive", loss: { files, commits, unpushedCommits: commits, commitList: [] } };
      }
      if (kind.kind === "deleteBranch") {
        const branch = branchesOf(path).find((candidate) => candidate.name === kind.name);
        return branch && !branch.merged && branch.upstream === null
          ? { kind: "destructive", loss: { files: [], commits: 2, unpushedCommits: 2, commitList: [] } }
          : { kind: "safe" };
      }
      if (kind.kind === "deleteRemoteBranch") {
        const keptLocally = branchesOf(path).some((b) => b.kind === "local" && b.name === kind.name);
        return keptLocally
          ? { kind: "safe" }
          : {
              kind: "destructive",
              loss: {
                files: [],
                commits: 2,
                unpushedCommits: 0,
                commitList: [
                  { shortId: "a1b2c3d", subject: `Work only on ${kind.remote}` },
                  { shortId: "d4e5f6a", subject: "Earlier work only there" },
                ],
              },
            };
      }
      if (kind.kind === "forcePush") {
        const { behind } = syncOf(path);
        return behind === 0
          ? { kind: "safe" }
          : { kind: "destructive", loss: { files: [], commits: behind, unpushedCommits: 0, commitList: [] } };
      }
      if (kind.kind === "abortOperation") {
        const status = statusOf(path);
        const files = [...status.conflicts, ...status.staged, ...status.unstaged];
        return files.length === 0
          ? { kind: "safe" }
          : { kind: "destructive", loss: { files, commits: 0, unpushedCommits: 0, commitList: [] } };
      }
      if (kind.kind !== "discardChanges") return { kind: "safe" };
      const files = statusOf(path).unstaged.filter((file) => kind.paths.includes(file.path));
      const assessment: Assessment =
        files.length === 0
          ? { kind: "safe" }
          : { kind: "destructive", loss: { files, commits: 0, unpushedCommits: 0, commitList: [] } };
      return assessment;
    },
    async discardChanges(path, paths) {
      const outcome = mutate(path, titleFor("Discard", paths), (status) => ({
        ...status,
        unstaged: status.unstaged.filter((file) => !paths.includes(file.path)),
      }));
      if (outcome.kind === "succeeded") discards.push({ worktreePath: path, paths });
      return outcome;
    },
    async cancelMutation(mutationId) {
      cancelled.push(mutationId);
    },
    async settings() {
      return settings;
    },
    async updateSettings(updated) {
      settings = updated;
      return settings;
    },
    async gitIdentity() {
      return identity;
    },
    async setGitIdentity(updated) {
      identity = { name: blankToNull(updated.name), email: blankToNull(updated.email) };
      return identity;
    },
    async repositoryGitIdentity(worktreePath) {
      const { repositoryName } = known(worktreePath);
      return (
        repositoryIdentities.get(repositoryName) ??
        state.repositoryIdentity ?? { name: null, email: null }
      );
    },
    async setRepositoryGitIdentity(worktreePath, updated) {
      const { repositoryName } = known(worktreePath);
      const stored = { name: blankToNull(updated.name), email: blankToNull(updated.email) };
      repositoryIdentities.set(repositoryName, stored);
      return stored;
    },
    async onEvent(handler) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    changeWorktree(path, status) {
      current.set(path, status);
      emit({ type: "worktreeChanged", worktreePath: path });
    },
    checkOut(path, head) {
      tabs.set(path, { ...known(path), head });
      emit({ type: "worktreeChanged", worktreePath: path });
    },
    setOperation(path, operation) {
      if (operation) operations.set(path, operation);
      else operations.delete(path);
      emit({ type: "worktreeChanged", worktreePath: path });
    },
    setTagsAndRemotes(path, tags, remotes) {
      tagLists.set(path, tags);
      remoteLists.set(path, remotes);
      emit({ type: "worktreeChanged", worktreePath: path });
    },
    setWorktreeDetails(path, worktrees) {
      worktreeLists.set(path, worktrees);
      emit({ type: "worktreeChanged", worktreePath: path });
    },
    setStashes(path, stashes) {
      stashLists.set(path, stashes);
      emit({ type: "worktreeChanged", worktreePath: path });
    },
    setCommitsDroppedByReset(commit, count) {
      resetDrops.set(commit, count);
    },
    setRebasePlan(path, from, plan) {
      rebasePlans.set(`${path}\0${from ?? ""}`, plan);
    },
    setConflictFile(path, file) {
      conflictFiles.set(`${path}\0${file.path}`, file);
    },
    setBranchDetails(path, list) {
      branchDetails.set(path, list);
      emit({ type: "worktreeChanged", worktreePath: path });
    },
    setSyncStatus(path, status) {
      syncStatuses.set(path, { ...syncOf(path), ...status });
      emit({ type: "worktreeChanged", worktreePath: path });
    },
    setScanResults(folder, found) {
      scanResults.set(folder, found);
    },
    setBranches(path, labels) {
      branches.set(path, labels);
    },
    loseRepository(path) {
      repositoryAt(path);
      lost.add(path);
    },
    setPolling(paths) {
      emit({ type: "pollingTabsChanged", worktreePaths: paths });
    },
    holdStatusReads() {
      let release = () => {};
      held = new Promise<void>((resolve) => {
        release = resolve;
      });
      return () => {
        release();
        held = null;
      };
    },
    emitEvent: emit,
    setOutgoingCommits(path, outgoingCommits) {
      outgoing.set(path, outgoingCommits);
      emit({ type: "worktreeChanged", worktreePath: path });
    },
    failNextMutation(failure) {
      failures.push(failure);
    },
    watchedWorktrees: watched,
    backgroundWatched,
    get savedView() {
      return savedView;
    },
    cancelledMutations: cancelled,
    commits,
    assessedMutations: assessed,
    discards,
    stagedLines,
    pullRequestActions,
    openedInEditor,
    openedFilesInEditor,
    tagRemoteActions,
    worktreeActions,
    stashActions,
    appliedPlans,
    conflictActions,
    resolvedContents,
    branchActions,
    syncActions,
    operationActions,
    commitActions,
    added,
    diffRequests,
    commitDiffRequests,
    commitDetailRequests,
    get activeWorktree() {
      return active;
    },
  };
}

function lastSegment(path: string): string {
  return path.split(/[/\\:]/).pop() ?? path;
}

function localBranch(name: string): BranchInfo {
  return {
    name,
    kind: "local",
    current: false,
    upstream: null,
    ahead: 0,
    behind: 0,
    merged: true,
    shortId: "abc1234",
  };
}

function titleFor(verb: string, paths: string[]): string {
  return paths.length === 1 ? `${verb} ${paths[0]}` : `${verb} ${paths.length} files`;
}

function asStaged(file: FileChange): FileChange {
  return file.kind === "untracked" ? { ...file, kind: "added" } : file;
}

function asUnstaged(file: FileChange): FileChange {
  return file.kind === "added" ? { ...file, kind: "untracked" } : file;
}

function linesTitle(verb: string, selection: LineSelection): string {
  const count = selection.lines.length;
  return `${verb} ${count === 1 ? "1 line" : `${count} lines`} of ${selection.path}`;
}

function sameLine(a: DiffLine, b: DiffLine): boolean {
  return a.kind === b.kind && a.oldNumber === b.oldNumber && a.newNumber === b.newNumber;
}

/** Whether the file still has changed lines in `list` once the selection has left it. */
function takeLines(
  diffs: Map<string, FileDiff>,
  list: ChangeList,
  selection: LineSelection,
): boolean {
  const key = diffKey({ list, path: selection.path });
  const diff = diffs.get(key);
  if (diff?.content.kind !== "text") return false;

  const hunks = diff.content.hunks
    .map((hunk) => ({
      ...hunk,
      lines: hunk.lines.filter((line) => !selection.lines.some((picked) => sameLine(picked, line))),
    }))
    .filter((hunk) => hunk.lines.some((line) => line.kind !== "context"));
  diffs.set(key, { ...diff, content: { kind: "text", hunks } });
  return hunks.length > 0;
}

function addLines(diffs: Map<string, FileDiff>, list: ChangeList, selection: LineSelection) {
  const key = diffKey({ list, path: selection.path });
  const diff = diffs.get(key) ?? {
    path: selection.path,
    originalPath: selection.originalPath,
    modeChange: null,
    content: { kind: "text" as const, hunks: [] },
  };
  if (diff.content.kind !== "text") return;

  const hunk: Hunk = {
    oldStart: selection.lines.find((line) => line.oldNumber !== null)?.oldNumber ?? 0,
    oldLines: selection.lines.filter((line) => line.kind === "removed").length,
    newStart: selection.lines.find((line) => line.newNumber !== null)?.newNumber ?? 0,
    newLines: selection.lines.filter((line) => line.kind === "added").length,
    lines: selection.lines,
  };
  diffs.set(key, { ...diff, content: { kind: "text", hunks: [...diff.content.hunks, hunk] } });
}

function blankToNull(value: string | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function isHashPrefix(text: string): boolean {
  return /^[0-9a-f]{4,40}$/.test(text);
}
