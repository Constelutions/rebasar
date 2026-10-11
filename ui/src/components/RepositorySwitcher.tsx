import { useEffect, useRef, useState } from "react";

import type { OpenTab } from "../useOpenTabs";
import { StatusDot } from "./StatusDot";
import { describeHead } from "./TabStrip";

interface RepositorySwitcherProps {
  tabs: OpenTab[];
  onSelect: (path: string) => void;
}

export function RepositorySwitcher({ tabs, onSelect }: RepositorySwitcherProps) {
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
      <button
        type="button"
        aria-label="Switch repository"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Switch repository"
        className="switcher-button"
        onClick={toggle}
      >
        ⇅
      </button>
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
              <button
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
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
