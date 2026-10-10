import type { Head } from "../core/api";
import type { OpenTab } from "../useOpenTabs";
import { StatusDot } from "./StatusDot";

interface TabStripProps {
  tabs: OpenTab[];
  activePath: string | undefined;
  onSelect: (path: string) => void;
}

export function TabStrip({ tabs, activePath, onSelect }: TabStripProps) {
  return (
    <div role="tablist" className="tab-strip">
      {tabs.map(({ tab, status }) => (
        <button
          key={tab.worktreePath}
          type="button"
          role="tab"
          aria-selected={tab.worktreePath === activePath}
          title={tab.worktreePath}
          className="tab"
          onClick={() => onSelect(tab.worktreePath)}
        >
          <StatusDot status={status} />
          <span className="tab-name">{tab.repositoryName}</span>
          <span className="tab-head">{describeHead(tab.head)}</span>
        </button>
      ))}
    </div>
  );
}

export function describeHead(head: Head): string {
  return head.kind === "branch" ? head.name : `detached at ${head.commit}`;
}
