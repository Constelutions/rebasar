import { type FormEvent, useEffect, useId, useState } from "react";

import {
  type CheckState,
  type CoreApi,
  type PullRequest,
  type PullRequestDetails,
  type ReviewState,
  type Tab,
  type TokenSource,
  isApiError,
} from "../core/api";
import { describeError } from "../core/describeError";
import { Button } from "./Button";
import { PullRequestDialog } from "./PullRequestDialog";

type Load =
  | { phase: "loading" }
  | { phase: "notGithub" }
  | { phase: "signedOut"; notice: string | null }
  | { phase: "ready"; pullRequests: PullRequest[]; source: TokenSource }
  | { phase: "failed"; message: string };

const checkLabels: Record<CheckState, string> = {
  none: "No checks",
  pending: "Checks running",
  success: "Checks passing",
  failure: "Checks failing",
};

const reviewLabels: Record<Exclude<ReviewState, "none">, string> = {
  reviewRequired: "Review required",
  changesRequested: "Changes requested",
  approved: "Approved",
};

export function PullRequestsView({ api, tab }: { api: CoreApi; tab: Tab }) {
  const [load, setLoad] = useState<Load>({ phase: "loading" });
  const [attempt, setAttempt] = useState(0);
  const reload = () => setAttempt((current) => current + 1);

  useEffect(() => {
    let current = true;
    setLoad({ phase: "loading" });
    void loadPullRequests(api, tab.worktreePath).then((result) => {
      if (current) setLoad(result);
    });
    return () => {
      current = false;
    };
  }, [api, tab.worktreePath, attempt]);

  switch (load.phase) {
    case "loading":
      return null;
    case "notGithub":
      return (
        <p className="placeholder">
          Pull requests are disabled: this Repository has no GitHub remote.
        </p>
      );
    case "failed":
      return (
        <p role="alert" className="error">
          {load.message}
        </p>
      );
    case "signedOut":
      return <SignIn api={api} notice={load.notice} onSignedIn={reload} />;
    case "ready":
      return (
        <PullRequestList
          api={api}
          worktreePath={tab.worktreePath}
          branch={tab.head.kind === "branch" ? tab.head.name : null}
          onChanged={reload}
          pullRequests={load.pullRequests}
          canSignOut={load.source === "personalAccessToken"}
          onSignOut={async () => {
            await api.signOutOfGitHub();
            reload();
          }}
        />
      );
  }
}

async function loadPullRequests(api: CoreApi, worktreePath: string): Promise<Load> {
  try {
    const remote = await api.githubRemote(worktreePath);
    if (remote === null) return { phase: "notGithub" };

    const { source } = await api.githubAuthStatus();
    if (source === null) return { phase: "signedOut", notice: null };

    const pullRequests = await api.pullRequests(worktreePath);
    return { phase: "ready", pullRequests, source };
  } catch (failure) {
    if (isApiError(failure) && failure.kind === "githubNotSignedIn") {
      return { phase: "signedOut", notice: null };
    }
    if (isApiError(failure) && failure.kind === "githubTokenRejected") {
      return { phase: "signedOut", notice: describeError(failure) };
    }
    return { phase: "failed", message: describeError(failure) };
  }
}

function SignIn({
  api,
  notice,
  onSignedIn,
}: {
  api: CoreApi;
  notice: string | null;
  onSignedIn: () => void;
}) {
  const inputId = useId();
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(notice);
  const [busy, setBusy] = useState(false);

  async function signIn(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.signInToGitHub(token);
      onSignedIn();
    } catch (failure) {
      setError(describeError(failure));
      setBusy(false);
    }
  }

  return (
    <form className="github-sign-in" onSubmit={signIn}>
      <p>
        Sign in to GitHub to see pull requests. Rebasar uses the token of the GitHub CLI when you
        are signed in there (<code>gh auth login</code>); otherwise paste a personal access token
        with access to the repository. It is kept in the Windows credential store and used only
        for GitHub, never by Git.
      </p>
      <label htmlFor={inputId}>Personal access token</label>
      <input
        id={inputId}
        type="password"
        autoComplete="off"
        value={token}
        onChange={(event) => setToken(event.target.value)}
      />
      <Button variant="primary" type="submit" disabled={busy || token.trim() === ""}>
        Sign in
      </Button>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </form>
  );
}

function PullRequestList({
  api,
  worktreePath,
  branch,
  onChanged,
  pullRequests,
  canSignOut,
  onSignOut,
}: {
  api: CoreApi;
  worktreePath: string;
  /** `null` while HEAD is detached, which has no pull request to make. */
  branch: string | null;
  onChanged: () => void;
  pullRequests: PullRequest[];
  canSignOut: boolean;
  onSignOut: () => Promise<void>;
}) {
  const [current, setCurrent] = useState<PullRequestDetails | null>(null);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setCurrent(null);
    if (branch !== null) {
      api.currentPullRequest(worktreePath).then(
        (found) => active && setCurrent(found),
        (failure) => active && setError(describeError(failure)),
      );
    }
    return () => {
      active = false;
    };
  }, [api, worktreePath, branch, pullRequests]);

  function attempt(action: Promise<unknown>) {
    setError(null);
    action.then(onChanged, (failure) => setError(describeError(failure)));
  }

  return (
    <div className="pull-requests">
      {branch !== null && (
        <div className="pull-request-toolbar">
          {current ? (
            <>
              <Button type="button" onClick={() => setEditing(true)}>
                Edit pull request #{current.number}
              </Button>
              <Button
                type="button"
                aria-label={`Open the current branch's pull request #${current.number} in the browser`}
                onClick={() => attempt(api.openInBrowser(current.url))}
              >
                Open #{current.number} in the browser
              </Button>
            </>
          ) : (
            <Button type="button" onClick={() => setEditing(true)}>
              Create pull request
            </Button>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {editing && (
        <PullRequestDialog
          api={api}
          worktreePath={worktreePath}
          existing={current}
          initialTitle={branch?.replace(/[-_/]+/g, " ") ?? ""}
          onClose={() => setEditing(false)}
          onSaved={onChanged}
        />
      )}
      {pullRequests.length === 0 ? (
        <p className="placeholder">No open pull requests.</p>
      ) : (
        <ul className="pull-request-list" aria-label="Open pull requests">
          {pullRequests.map((pullRequest) => (
            <PullRequestRow
              key={pullRequest.number}
              pullRequest={pullRequest}
              onOpen={() => attempt(api.openInBrowser(pullRequest.url))}
              onReady={() =>
                attempt(api.markPullRequestReady(worktreePath, pullRequest.number))
              }
            />
          ))}
        </ul>
      )}
      {canSignOut && (
        <Button type="button" className="github-sign-out" onClick={() => void onSignOut()}>
          Sign out of GitHub
        </Button>
      )}
    </div>
  );
}

function PullRequestRow({
  pullRequest,
  onOpen,
  onReady,
}: {
  pullRequest: PullRequest;
  onOpen: () => void;
  onReady: () => void;
}) {
  return (
    <li className="pull-request">
      <span className="pull-request-number">#{pullRequest.number}</span>
      <span className="pull-request-title">{pullRequest.title}</span>
      {pullRequest.isDraft && <span className="badge badge-draft">Draft</span>}
      <span className="pull-request-branches">
        {pullRequest.headBranch} → {pullRequest.baseBranch}
      </span>
      <span className="pull-request-author">{pullRequest.author}</span>
      <span className={`badge badge-checks-${pullRequest.checks}`}>
        {checkLabels[pullRequest.checks]}
      </span>
      {pullRequest.review !== "none" && (
        <span className={`badge badge-review-${pullRequest.review}`}>
          {reviewLabels[pullRequest.review]}
        </span>
      )}
      <span className="pull-request-actions">
        <Button size="sm" type="button" aria-label={`Open #${pullRequest.number} in the browser`} onClick={onOpen}>
          Open
        </Button>
        {pullRequest.isDraft && (
          <Button
            size="sm"
            type="button"
            aria-label={`Mark #${pullRequest.number} ready for review`}
            onClick={onReady}
          >
            Ready for review
          </Button>
        )}
      </span>
    </li>
  );
}
