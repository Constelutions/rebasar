export const COMMIT_TYPES = ["feat", "fix", "refactor", "chore", "docs", "test"] as const;

export type CommitType = (typeof COMMIT_TYPES)[number];

/** The length that Git tooling conventionally keeps a subject line under. */
export const SUBJECT_LIMIT = 72;

const PREFIX = new RegExp(`^(${COMMIT_TYPES.join("|")})(\\([^)]*\\))?(!)?:\\s?`);

export function typeOf(subject: string): CommitType | undefined {
  return PREFIX.exec(subject)?.[1] as CommitType | undefined;
}

/** Swaps the type prefix, keeping any scope; `undefined` removes the prefix. */
export function withType(subject: string, type: CommitType | undefined): string {
  const match = PREFIX.exec(subject);
  if (!match) return type ? `${type}: ${subject}` : subject;

  const rest = subject.slice(match[0].length);
  if (!type) return rest;
  return `${type}${match[2] ?? ""}${match[3] ?? ""}: ${rest}`;
}

export function messageOf(subject: string, body: string): string {
  return body.trim() === "" ? subject.trim() : `${subject.trim()}\n\n${body.trim()}`;
}
