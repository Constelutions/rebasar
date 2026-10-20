export const COMMIT_TYPES = ["feat", "fix", "refactor", "chore", "docs", "test"] as const;

export type CommitType = (typeof COMMIT_TYPES)[number];

/** The length that Git tooling conventionally keeps a subject line under. */
export const SUBJECT_LIMIT = 72;

const PREFIX = new RegExp(`^(${COMMIT_TYPES.join("|")})(\\([^)]*\\))?(!)?:\\s?`);

/** The first line of a message is its subject; the rest is the body. */
export function subjectOf(message: string): string {
  const end = message.indexOf("\n");
  return end === -1 ? message : message.slice(0, end);
}

export function typeOf(message: string): CommitType | undefined {
  return PREFIX.exec(subjectOf(message))?.[1] as CommitType | undefined;
}

/** Swaps the type prefix of the subject, keeping any scope; `undefined` removes the prefix. */
export function withType(message: string, type: CommitType | undefined): string {
  const subject = subjectOf(message);
  const body = message.slice(subject.length);
  const match = PREFIX.exec(subject);
  if (!match) return (type ? `${type}: ${subject}` : subject) + body;

  const rest = subject.slice(match[0].length);
  if (!type) return rest + body;
  return `${type}${match[2] ?? ""}${match[3] ?? ""}: ${rest}${body}`;
}
