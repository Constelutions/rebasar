import type { Head, Tab } from "../core/api";

export function TabStrip({ tabs }: { tabs: Tab[] }) {
  return (
    <div role="tablist" className="tab-strip">
      {tabs.map((tab, index) => (
        <div
          key={tab.worktreePath}
          role="tab"
          aria-selected={index === tabs.length - 1}
          title={tab.worktreePath}
          className="tab"
        >
          <span className="tab-name">{tab.repositoryName}</span>
          <span className="tab-head">{describeHead(tab.head)}</span>
        </div>
      ))}
    </div>
  );
}

function describeHead(head: Head): string {
  return head.kind === "branch" ? head.name : `detached at ${head.commit}`;
}
