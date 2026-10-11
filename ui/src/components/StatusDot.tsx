import type { WorktreeStatus } from "../core/api";

type DotState = "unknown" | "clean" | "changed" | "conflicted";

const labels: Record<DotState, string> = {
  unknown: "Status not loaded yet",
  clean: "No changes",
  changed: "Has changes",
  conflicted: "Has conflicts",
};

function stateOf(status: WorktreeStatus | null): DotState {
  if (!status) return "unknown";
  if (status.conflicts.length > 0) return "conflicted";
  if (status.staged.length > 0 || status.unstaged.length > 0) return "changed";
  return "clean";
}

export function StatusDot({ status }: { status: WorktreeStatus | null }) {
  const state = stateOf(status);
  return <span role="img" aria-label={labels[state]} data-state={state} className="status-dot" />;
}
