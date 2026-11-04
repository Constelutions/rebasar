// Illustrative content for the faux-UI panels. Names, hashes, ages, PR numbers and paths are
// invented, as the mockup notes describe; none of it is real data.
import type { GraphCommit, RefKind } from "../lib/commit-graph";

const WARNING = "var(--color-warning)";
const SUCCESS = "var(--color-success)";
const MUTED = "var(--color-text-muted)";

export const REF_COLORS: Record<RefKind, { bg: string; fg: string }> = {
  head: { bg: "oklch(0.3 0.06 250)", fg: "oklch(0.85 0.1 250)" },
  remote: { bg: "oklch(0.3 0.06 150)", fg: "oklch(0.85 0.1 150)" },
  pr: { bg: "oklch(0.3 0.07 40)", fg: "oklch(0.85 0.1 40)" },
  tag: { bg: "oklch(0.3 0.05 85)", fg: "oklch(0.88 0.1 85)" },
  local: { bg: "oklch(0.28 0.05 310)", fg: "oklch(0.85 0.09 310)" },
};

export const commits: GraphCommit[] = [
  { hash: "a41f9c2", message: "feat(invoice): export invoices as CSV", lane: 1, author: "Mara", age: "12m", parents: [1], refs: [["HEAD → feat/invoice-export", "head"]] },
  { hash: "90be317", message: "refactor(invoice): extract row formatter", lane: 1, author: "Mara", age: "1h", parents: [4] },
  { hash: "c77d0aa", message: "Merge pull request #482 from fix/token-refresh", lane: 0, author: "Tomás", age: "3h", parents: [6, 3], refs: [["origin/main", "remote"]] },
  { hash: "5e2b8d1", message: "fix(auth): refresh token before expiry", lane: 2, author: "Jun", age: "5h", parents: [5], refs: [["#482", "pr"]] },
  { hash: "3d90f44", message: "feat(invoice): add currency column", lane: 1, author: "Mara", age: "1d", parents: [6] },
  { hash: "b81c6e0", message: "test(auth): cover refresh race", lane: 2, author: "Jun", age: "1d", parents: [6] },
  { hash: "0fa3392", message: "chore(deps): bump zod to 3.24", lane: 0, author: "Tomás", age: "2d", parents: [8] },
  { hash: "9c04d2e", message: "chore(deps): try pnpm 10", lane: 3, author: "Sam", age: "2d", parents: [8], refs: [["chore/deps", "local"]] },
  { hash: "7c10de8", message: "fix(test): stabilise flaky retry test", lane: 0, author: "Tomás", age: "3d", parents: [9] },
  { hash: "2a6f5b3", message: "feat(billing): add proration preview", lane: 0, author: "Mara", age: "4d", parents: [10], refs: [["v0.9.0", "tag"]] },
  { hash: "e9d4410", message: "feat(auth): add service tokens", lane: 0, author: "Jun", age: "1w", parents: [11] },
  { hash: "18c7a9f", message: "refactor(routes): split router module", lane: 0, author: "Tomás", age: "1w", parents: [] },
];

export const SELECTED_COMMIT = 3;

export interface TabSample {
  repo: string;
  branch: string;
  dot: string;
  active: boolean;
}

const tab = (repo: string, branch: string, dot: string, active = false): TabSample => ({ repo, branch, dot, active });

export const heroTabs = [
  tab("api-gateway", "feat/invoice-export", WARNING, true),
  tab("api-gateway", "fix/token-refresh", SUCCESS),
  tab("billing-service", "main", MUTED),
  tab("web-app", "main", MUTED),
];

export const groupTabs = [
  tab("api-gateway", "feat/invoice-export", WARNING, true),
  tab("api-gateway", "fix/token-refresh", SUCCESS),
  tab("web-app", "main", MUTED),
];

export const worktreeTabs = [
  tab("api-gateway", "main", MUTED),
  tab("api-gateway", "feat/invoice-export", WARNING, true),
  tab("api-gateway", "fix/token-refresh", SUCCESS),
];

export interface SideRow {
  label: string;
  kind: "group" | "repo" | "nav";
  count?: string;
  sub?: string;
  dot?: string;
  active?: boolean;
  gapBefore?: number;
}

export const sidebar: SideRow[] = [
  { label: "Backend", kind: "group", count: "3" },
  { label: "api-gateway", kind: "repo", dot: WARNING, sub: "feat/invoice-export", active: true },
  { label: "billing-service", kind: "repo", dot: MUTED, sub: "main" },
  { label: "infra", kind: "repo", dot: MUTED, sub: "main" },
  { label: "Web", kind: "group", count: "1", gapBefore: 10 },
  { label: "web-app", kind: "repo", dot: MUTED, sub: "main" },
  { label: "History", kind: "nav", active: true, gapBefore: 16 },
  { label: "Changes", kind: "nav", count: "3" },
  { label: "Branches", kind: "nav", count: "6" },
  { label: "Stashes", kind: "nav", count: "2" },
  { label: "Tags", kind: "nav" },
  { label: "Remotes", kind: "nav" },
  { label: "Pull requests", kind: "nav", count: "3" },
];

export const heroFiles = [
  { name: "src/auth/refresh.ts", status: "M", statusColor: WARNING, added: 14, removed: 3, selected: true },
  { name: "src/auth/index.ts", status: "M", statusColor: WARNING, added: 6, removed: 1, selected: false },
  { name: "test/refresh.test.ts", status: "A", statusColor: SUCCESS, added: 41, removed: 0, selected: false },
];

export type DiffKind = "+" | "-" | " ";

export const miniDiff: { text: string; kind: DiffKind }[] = [
  { text: "  if (expiresIn < 60) {", kind: "+" },
  { text: "+   await refreshToken()", kind: "+" },
  { text: "  }", kind: " " },
  { text: "- return send(req, token)", kind: "-" },
  { text: "+ return send(req, current())", kind: "+" },
  { text: "  return res", kind: " " },
];

export const stats = [
  { value: "38", unit: "ms", label: "Commit graph, first page, 1.2 M commits", target: "Target < 2,000 ms" },
  { value: "211", unit: "ms", label: "Status on a 100,000-file tree", target: "Target < 300 ms" },
  { value: "530", unit: "ms", label: "Cold start to interactive", target: "Target < 1,000 ms" },
  { value: "134", unit: "MB", label: "Idle memory, 20 Repositories and 50 Worktrees", target: "Target < 300 MB" },
];

export const sidebarGroups = [
  { label: "Backend", group: true, sub: "3" },
  { label: "api-gateway", selected: true, sub: "feat/invoice-export" },
  { label: "billing-service", sub: "main" },
  { label: "Web", group: true, sub: "1" },
  { label: "web-app", sub: "main" },
];

export const filterGraph = [
  { message: "feat(invoice): export invoices as CSV", hash: "a41f9c2", lane: "oklch(0.75 0.13 150)", rail: "oklch(0.3 0.012 265)", selected: true },
  { message: "refactor(invoice): extract row formatter", hash: "90be317", lane: "oklch(0.75 0.13 150)", rail: "oklch(0.3 0.012 265)", selected: false },
  { message: "feat(invoice): add currency column", hash: "3d90f44", lane: "oklch(0.75 0.13 150)", rail: "oklch(0.75 0.13 150)", selected: false },
  { message: "chore(deps): bump zod to 3.24", hash: "0fa3392", lane: "oklch(0.75 0.13 150)", rail: "oklch(0.3 0.012 265)", selected: false },
];

export const stagingDiff: { text: string; kind: DiffKind; picked: boolean }[] = [
  { text: "const rows = items.map(format)", kind: " ", picked: false },
  { text: "const sub = sum(rows)", kind: "+", picked: true },
  { text: "const tax = sub * rate", kind: "-", picked: false },
  { text: "const tax = round(sub * rate)", kind: "+", picked: true },
  { text: "const fee = sub * 0.01", kind: "+", picked: false },
  { text: "return sub + tax", kind: "+", picked: true },
  { text: "return sub + tax + fee", kind: "-", picked: false },
];

export const commitTypes = ["feat", "fix", "refactor", "chore", "docs"];

export const rebaseRows = [
  { action: "pick", hash: "3d90f44", message: "feat(invoice): add currency column", hue: 250, selected: false, dropped: false },
  { action: "squash", hash: "90be317", message: "refactor(invoice): extract row…", hue: 150, selected: true, dropped: false },
  { action: "fixup", hash: "b81c6e0", message: "test(auth): cover refresh race", hue: 85, selected: false, dropped: false },
  { action: "drop", hash: "9c04d2e", message: "chore(deps): try pnpm 10", hue: 25, selected: false, dropped: true },
];

export const conflictOurs = [
  { text: "const raw = list()", changed: false },
  { text: "  .filter(isOpen)", changed: true },
  { text: "return raw", changed: true },
];

export const conflictTheirs = [
  { text: "const raw = list()", changed: false },
  { text: "  .map(parse)", changed: true },
  { text: "return clean(raw)", changed: true },
];

export const miscRows = [
  { name: "stash@{0}", detail: "wip: invoice totals", color: WARNING, selected: true },
  { name: "stash@{1}", detail: "wip: retry backoff", color: WARNING, selected: false },
  { name: "v0.9.0", detail: "2a6f5b3 · tag", color: "oklch(0.82 0.13 85)", selected: false },
  { name: "origin", detail: "git@github.com:acme/api-gateway.git", color: SUCCESS, selected: false },
  { name: "upstream", detail: "git@github.com:acme/api-core.git", color: SUCCESS, selected: false },
];

export const pullRequests = [
  { number: "#491", title: "feat(invoice): export invoices as CSV", branches: "feat/invoice-export → main", state: "Draft", bg: "var(--color-hover)", fg: "oklch(0.8 0.02 265)", selected: true },
  { number: "#487", title: "perf: cache route table", branches: "perf/route-cache → main", state: "Open", bg: "oklch(0.3 0.06 150)", fg: "oklch(0.9 0.08 150)", selected: false },
  { number: "#482", title: "fix(auth): refresh token before expiry", branches: "fix/token-refresh → main", state: "Merged", bg: "oklch(0.28 0.05 310)", fg: "oklch(0.88 0.08 310)", selected: false },
];

export const worktreeRows = [
  { branch: "main", path: "~/work/api-gateway", state: "clean", stateColor: SUCCESS, dot: MUTED, selected: false },
  { branch: "feat/invoice-export", path: "~/work/api-gateway-invoice", state: "3 changed", stateColor: WARNING, dot: WARNING, selected: true },
  { branch: "fix/token-refresh", path: "~/work/api-gateway-token", state: "clean", stateColor: SUCCESS, dot: SUCCESS, selected: false },
];

export const lossRows = [
  { count: "3", text: "uncommitted lines in", file: "src/billing/invoice.ts" },
  { count: "8", text: "uncommitted lines in", file: "src/billing/totals.ts" },
  { count: "1", text: "uncommitted line in", file: "src/api/routes.ts" },
  { count: "5", text: "uncommitted lines in", file: "test/invoice.test.ts" },
];

export type PaletteRow =
  | { header: string }
  | { title: string; sub: string; active?: boolean; mono?: boolean };

export const paletteRows: PaletteRow[] = [
  { header: "Commands" },
  { title: "Create pull request for feat/invoice-export", sub: "Command", active: true },
  { header: "Tabs" },
  { title: "api-gateway · feat/invoice-export", sub: "Tab" },
  { header: "Branches" },
  { title: "feat/invoice-export", sub: "Branch · api-gateway", mono: true },
  { header: "Commits" },
  { title: "feat(invoice): export invoices as CSV", sub: "a41f9c2 · Mara Ilves · 12m" },
];
