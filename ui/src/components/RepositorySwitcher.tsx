import { useCallback, useRef, useState } from "react";

import { useDismiss } from "../useDismiss";
import type { OpenTab } from "../useOpenTabs";
import { Button } from "./Button";
import { StatusDot } from "./StatusDot";
import { describeHead } from "./TabStrip";
import { TruncatedText } from "./TruncatedText";
import { TextInput } from "./FormControls";

interface RepositorySwitcherProps {
  tabs: OpenTab[];
  activePath: string | undefined;
  onSelect: (path: string) => void;
}

function worktreeName(path: string): string {
  return path.split(/[/\\]/).filter(Boolean).pop() ?? path;
}

export function RepositorySwitcher({ tabs, activePath, onSelect }: RepositorySwitcherProps) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const container = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);

  useDismiss(open, container, close);

  const active = tabs.find(({ tab }) => tab.worktreePath === activePath)?.tab;
  const activeWorktreeName = active && worktreeName(active.worktreePath);
  const needle = filter.trim().toLowerCase();
  const matches = tabs.filter(({ tab }) =>
    `${tab.repositoryName} ${describeHead(tab.head)}`.toLowerCase().includes(needle),
  );

  function toggle() {
    setFilter("");
    setOpen((current) => !current);
  }

  return (
    <div ref={container} className="repository-switcher">
      <Button
        variant="plain"
        type="button"
        aria-label="Switch repository"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Switch repository"
        className="switcher-button"
        onClick={toggle}
      >
        <span aria-hidden="true">⇅</span>
        {active && (
          <span className="switcher-names">
            <span className="switcher-worktree" title={activeWorktreeName}>
              {activeWorktreeName}
            </span>
            <span className="switcher-head" title={describeHead(active.head)}>
              {describeHead(active.head)}
            </span>
          </span>
        )}
      </Button>
      {open && (
        <div className="switcher-popover">
          <TextInput
            type="search"
            autoFocus
            aria-label="Filter Repositories"
            placeholder="Filter"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
          <div role="menu" aria-label="Repositories" className="switcher-list">
            {matches.map(({ tab, status }) => (
              <Button
                variant="plain"
                key={tab.worktreePath}
                type="button"
                role="menuitem"
                title={tab.worktreePath}
                className="switcher-item"
                onClick={() => {
                  onSelect(tab.worktreePath);
                  setOpen(false);
                }}
              >
                <StatusDot status={status} />
                <TruncatedText className="tab-name" text={tab.repositoryName} />
                <TruncatedText className="tab-head" text={describeHead(tab.head)} />
              </Button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
