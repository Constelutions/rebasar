import type { RefLabel } from "../core/api";

const kindNames = {
  head: "head",
  localBranch: "local-branch",
  remoteBranch: "remote-branch",
  tag: "tag",
} as const;

export function RefBadge({ label }: { label: RefLabel }) {
  return <span className={`ref-badge ref-${kindNames[label.kind]}`}>{label.name}</span>;
}
