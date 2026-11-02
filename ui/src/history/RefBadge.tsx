import type { RefKind, RefLabel } from "../core/api";
import { TruncatedText } from "../components/TruncatedText";

const kindNames = {
  head: "head",
  localBranch: "local-branch",
  remoteBranch: "remote-branch",
  tag: "tag",
} as const;

/** Past this many a commit's refs collapse into a `+N` chip, so the row keeps room for its subject. */
export const MAX_VISIBLE_REFS = 2;

const priority: Record<RefKind, number> = { head: 0, localBranch: 1, tag: 2, remoteBranch: 3 };

export function RefBadge({ label }: { label: RefLabel }) {
  return <TruncatedText className={`ref-badge ref-${kindNames[label.kind]}`} text={label.name} />;
}

/** `HEAD` and the Branches of this repository come first, since they are what the user is looking for. */
export function RefBadges({ refs }: { refs: RefLabel[] }) {
  const ordered = [...refs].sort((a, b) => priority[a.kind] - priority[b.kind]);
  const visible = ordered.slice(0, MAX_VISIBLE_REFS);
  const hidden = ordered.slice(MAX_VISIBLE_REFS);

  return (
    <span className="commit-refs">
      {visible.map((label) => (
        <RefBadge key={`${label.kind}-${label.name}`} label={label} />
      ))}
      {hidden.length > 0 && (
        <TruncatedText
          className="ref-badge ref-more"
          text={`+${hidden.length}`}
          tip={hidden.map((label) => label.name).join("\n")}
        />
      )}
    </span>
  );
}
