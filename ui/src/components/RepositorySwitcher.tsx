import { useEffect, useRef, useState } from "react";

import type { OpenTab } from "../useOpenTabs";
import { Button } from "./Button";
import { StatusDot } from "./StatusDot";
import { describeHead } from "./TabStrip";

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

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    function onPointerDown(event: PointerEvent) {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  const active = tabs.find(({ tab }) => tab.worktreePath === activePath)?.tab;
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
            <span className="switcher-worktree" title={worktreeName(active.worktreePath)}>
              {worktreeName(active.worktreePath)}
            </span>
            <span className="switcher-head" title={describeHead(active.head)}>
              {describeHead(active.head)}
            </span>
          </span>
        )}
      </Button>
      {open && (
        <div className="switcher-popover">
          <input
            type="search"
            autoFocus
            aria-label="Filter Repositories"
            placeholder="Filter"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            className="switcher-filter"
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
                <span className="tab-name">{tab.repositoryName}</span>
                <span className="tab-head">{describeHead(tab.head)}</span>
              </Button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
