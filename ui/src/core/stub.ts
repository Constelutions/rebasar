import {
  type CommitDetail,
  type CommitDiffRequest,
  type CoreApi,
  type CoreEvent,
  type DiffRequest,
  type FileChange,
  type FileDiff,
  type GitHubAuthStatus,
  type GitHubRepository,
  type GitSetup,
  type GitIdentity,
  type Head,
  type HistoryRow,
  type MutationOutcome,
  type PullRequest,
  type Tab,
  type TokenSource,
  type WorktreeStatus,
  type Settings,
  defaultSettings,
} from "./api";

export const emptyStatus: WorktreeStatus = { conflicts: [], staged: [], unstaged: [] };

export function diffKey({ list, path }: Pick<DiffRequest, "list" | "path">) {
  return `${list}:${path}`;
}

const ready: GitSetup = { kind: "ready", version: "2.47.1" };

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

export interface MutationFailure {
  exitCode: number;
  /** Written to stderr, as a failing hook would. */
  output: string[];
}

export interface StubCoreState {
  settings?: Settings;
  identity?: GitIdentity;
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
}

export interface StubCoreApi extends CoreApi {
  /** Replaces what the Worktree reports, as an edit made outside the app would. */
  changeWorktree(path: string, status: WorktreeStatus): void;
  /** Switches the branch of a Worktree outside the app and reports it as a change. */
  checkOut(path: string, head: Head): void;
  /** Reports which Tabs the core has fallen back to polling, as when the watch limit is hit. */
  setPolling(paths: string[]): void;
  /** Makes status reads wait until the returned function is called. */
  holdStatusReads(): () => void;
  /** Delivers an event as if the core had emitted it, to drive streaming and progress. */
  emitEvent(event: CoreEvent): void;
  /** Makes the next stage, unstage or commit fail the way `git` would. */
  failNextMutation(failure: MutationFailure): void;
  readonly watchedWorktrees: ReadonlySet<string>;
  readonly cancelledMutations: readonly number[];
  readonly commits: readonly { worktreePath: string; message: string }[];
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
  { commitDetails = {}, commitDiffs = {} }: StubCommits = {},
): StubCoreApi {
  const handlers = new Set<(event: CoreEvent) => void>();
  const current = new Map(Object.entries(statuses));
  const tabs = new Map(Object.entries(repositories));
  const watched = new Set<string>();
  const diffRequests: DiffRequest[] = [];
  const commitDiffRequests: CommitDiffRequest[] = [];
  const commitDetailRequests: (readonly [string, number])[] = [];
  const cancelled: number[] = [];
  const commits: { worktreePath: string; message: string }[] = [];
  const failures: MutationFailure[] = [];
  let nextMutationId = 1;
  let settings = state.settings ?? defaultSettings;
  let identity = state.identity ?? { name: null, email: null };
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
    emit({ type: "mutationQueued", mutation: { id: mutationId, worktreePath: path, title } });
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

  return {
    async openFolder(path) {
      const tab = known(path);
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
        diffs[diffKey(request)] ?? {
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
    async activateTab(path) {
      known(path);
      watched.add(path);
      active = path;
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
      if (!github.remotes?.[path]) throw { kind: "notGithub", path };
      if (source === null) throw { kind: "githubNotSignedIn" };
      return github.pullRequests?.[path] ?? [];
    },
    async checkGit() {
      return gitSetup;
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
    async commit(path, message) {
      if (statusOf(path).staged.length === 0) {
        failures.unshift({ exitCode: 1, output: ["nothing to commit"] });
      }
      const outcome = mutate(path, "Commit", (status) => ({ ...status, staged: [] }));
      if (outcome.kind === "succeeded") commits.push({ worktreePath: path, message });
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
    failNextMutation(failure) {
      failures.push(failure);
    },
    watchedWorktrees: watched,
    cancelledMutations: cancelled,
    commits,
    diffRequests,
    commitDiffRequests,
    commitDetailRequests,
    get activeWorktree() {
      return active;
    },
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

function blankToNull(value: string | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}
