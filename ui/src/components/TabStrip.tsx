import type { Head } from "../core/api";
import type { OpenTab } from "../useOpenTabs";
import { Button } from "./Button";
import { StatusDot } from "./StatusDot";

interface TabStripProps {
  tabs: OpenTab[];
  activePath: string | undefined;
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
}

export function TabStrip({ tabs, activePath, onSelect, onClose }: TabStripProps) {
  return (
    <div role="tablist" className="tab-strip">
      {tabs.map(({ tab, status }) => (
        <div
          key={tab.worktreePath}
          className="tab"
          data-selected={tab.worktreePath === activePath}
        >
          <Button
            variant="plain"
            className="tab-close"
            aria-label={`Close ${tab.repositoryName} · ${describeHead(tab.head)}`}
            onClick={() => onClose(tab.worktreePath)}
          >
            ×
          </Button>
          <Button
            variant="plain"
            type="button"
            role="tab"
            aria-selected={tab.worktreePath === activePath}
            title={tab.worktreePath}
            className="tab-select"
            onClick={() => onSelect(tab.worktreePath)}
          >
            <StatusDot status={status} />
            <span className="tab-name">{tab.repositoryName}</span>
            <span className="tab-head">{describeHead(tab.head)}</span>
          </Button>
        </div>
      ))}
    </div>
  );
}

export function describeHead(head: Head): string {
  return head.kind === "branch" ? head.name : `detached at ${head.commit}`;
}
