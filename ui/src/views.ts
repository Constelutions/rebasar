export const viewGroups = [
  ["Home", "History", "Changes", "Conflicts"],
  ["Branches", "Stashes", "Worktrees", "Pull requests"],
  ["Repositories", "Settings"],
] as const;

export type ViewName = (typeof viewGroups)[number][number];
