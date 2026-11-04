export const viewGroups = [
  ["Home"],
  ["History", "Changes", "Pull requests", "Conflicts"],
  ["Worktrees", "Branches", "Stashes", "Tags", "Remotes"],
  ["Repositories", "Settings"],
] as const;

export type ViewName = (typeof viewGroups)[number][number];

export function isViewName(value: string | null): value is ViewName {
  return viewGroups.some((group) => (group as readonly string[]).includes(value ?? ""));
}
