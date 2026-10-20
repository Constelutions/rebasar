import type { BranchInfo, BranchesFilter } from "../core/api";

export interface RemoteBranch {
  remote: string;
  info: BranchInfo;
}

/** A Branch as the Branches page shows it: once, wherever it exists. */
export interface BranchRow {
  name: string;
  local: BranchInfo | null;
  remotes: RemoteBranch[];
}

/** The local entry when there is one, otherwise the first remote one. */
export function detailsOf(row: BranchRow): BranchInfo {
  return row.local ?? (row.remotes[0] as RemoteBranch).info;
}

export function buildBranchRows(branches: readonly BranchInfo[], remoteNames: readonly string[]): BranchRow[] {
  const rows = new Map<string, BranchRow>();
  for (const info of branches.filter((branch) => branch.kind === "local")) {
    rows.set(info.name, { name: info.name, local: info, remotes: [] });
  }
  for (const info of branches.filter((branch) => branch.kind === "remote")) {
    const { remote, name } = splitRemote(info.name, remoteNames);
    const row = rows.get(name) ?? { name, local: null, remotes: [] };
    row.remotes.push({ remote, info });
    rows.set(name, row);
  }
  return [...rows.values()];
}

/** A remote's own name may contain a slash, so the known names win over cutting at the first one. */
function splitRemote(refName: string, remoteNames: readonly string[]) {
  const known = remoteNames
    .filter((remote) => refName.startsWith(`${remote}/`))
    .sort((a, b) => b.length - a.length)[0];
  const cut = known === undefined ? refName.indexOf("/") : known.length;
  return cut < 0
    ? { remote: "", name: refName }
    : { remote: refName.slice(0, cut), name: refName.slice(cut + 1) };
}

export function filterBranchRows(rows: readonly BranchRow[], filter: BranchesFilter, search: string): BranchRow[] {
  const needle = search.trim().toLowerCase();
  return rows.filter((row) => {
    if (filter === "local" && row.local === null) return false;
    if (filter === "remote" && row.remotes.length === 0) return false;
    return row.name.toLowerCase().includes(needle);
  });
}
