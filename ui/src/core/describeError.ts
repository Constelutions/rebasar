import { type ApiError, isApiError } from "./api";

export function describeError(failure: unknown): string {
  if (!isApiError(failure)) return String(failure);
  return describeApiError(failure);
}

function describeApiError(error: ApiError): string {
  switch (error.kind) {
    case "folderNotFound":
      return `${error.path} does not exist.`;
    case "notARepository":
      return `${error.path} is not a Git repository.`;
    case "notGithub":
      return `${error.path} has no GitHub remote.`;
    case "githubNotSignedIn":
      return "You are not signed in to GitHub.";
    case "githubTokenRejected":
      return "GitHub did not accept the token.";
    case "githubRequestFailed":
    case "invalidQuery":
    case "unexpected":
      return error.message;
  }
}
