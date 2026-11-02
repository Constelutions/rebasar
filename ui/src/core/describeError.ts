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
    case "groupNotFound":
      return "That Group no longer exists.";
    case "repositoryNotFound":
      return `${error.path} is not a known Repository.`;
    case "invalidGroupName":
      return "A Group needs a name.";
    case "alreadyARepository":
      return `${error.path} is already a Git repository.`;
    case "invalidRepositoryUrl":
      return `Cannot tell the name of a Repository from ${error.url}.`;
    case "pullRequestsUnavailable":
      return error.hint ? `${error.message} ${error.hint}` : error.message;
    case "githubTokenRejected":
      return "GitHub did not accept the token.";
    case "githubRequestFailed":
    case "gitFailed":
    case "invalidQuery":
    case "unexpected":
      return error.message;
  }
}
