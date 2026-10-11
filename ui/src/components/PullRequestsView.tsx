import { type FormEvent, useEffect, useId, useState } from "react";

import {
  type CheckState,
  type CoreApi,
  type PullRequest,
  type ReviewState,
  type Tab,
  type TokenSource,
  isApiError,
} from "../core/api";
import { describeError } from "../core/describeError";

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
      <button type="submit" disabled={busy || token.trim() === ""}>
        Sign in
      </button>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </form>
  );
}

function PullRequestList({
  pullRequests,
  canSignOut,
  onSignOut,
}: {
  pullRequests: PullRequest[];
  canSignOut: boolean;
  onSignOut: () => Promise<void>;
}) {
  return (
    <div className="pull-requests">
      {pullRequests.length === 0 ? (
        <p className="placeholder">No open pull requests.</p>
      ) : (
        <ul className="pull-request-list" aria-label="Open pull requests">
          {pullRequests.map((pullRequest) => (
            <PullRequestRow key={pullRequest.number} pullRequest={pullRequest} />
          ))}
        </ul>
      )}
      {canSignOut && (
        <button type="button" className="github-sign-out" onClick={() => void onSignOut()}>
          Sign out of GitHub
        </button>
      )}
    </div>
  );
}

function PullRequestRow({ pullRequest }: { pullRequest: PullRequest }) {
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
    </li>
  );
}
