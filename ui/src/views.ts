export const viewGroups = [
  ["Home"],
  ["Changes", "Pull requests", "History", "Conflicts"],
  ["Worktrees", "Branches", "Stashes"],
  ["Repositories", "Settings"],
] as const;

export type ViewName = (typeof viewGroups)[number][number];

export function isViewName(value: string | null): value is ViewName {
  return viewGroups.some((group) => (group as readonly string[]).includes(value ?? ""));
}
