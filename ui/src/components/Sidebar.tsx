import { Fragment } from "react";

import { type ViewName, viewGroups } from "../views";
import { Button } from "./Button";
import { SidebarToggleIcon, ViewIcon } from "./SidebarIcons";

interface SidebarProps {
  selected: ViewName;
  collapsed: boolean;
  onSelect: (view: ViewName) => void;
  onToggleCollapsed: () => void;
  version: string | undefined;
  onShowAbout: () => void;
}

export function Sidebar({
  selected,
  collapsed,
  onSelect,
  onToggleCollapsed,
  version,
  onShowAbout,
}: SidebarProps) {
  const toggleLabel = collapsed ? "Expand sidebar" : "Collapse sidebar";

  return (
    <aside className="sidebar" data-collapsed={collapsed}>
      <nav aria-label="Views">
        {viewGroups.map((group, index) => (
          <Fragment key={group[0]}>
            {index > 0 && <hr className="sidebar-separator" />}
            <div role="group" className="sidebar-group">
              {group.map((view) => (
                <Button
                  variant="plain"
                  key={view}
                  aria-current={view === selected ? "page" : undefined}
                  aria-label={collapsed ? view : undefined}
                  title={collapsed ? view : undefined}
                  className="sidebar-item"
                  onClick={() => onSelect(view)}
                >
                  <ViewIcon view={view} />
                  {!collapsed && view}
                </Button>
              ))}
            </div>
          </Fragment>
        ))}
      </nav>
      <div className="sidebar-footer">
        {!collapsed && version && (
          <Button
            variant="plain"
            title="About Rebasar"
            className="sidebar-item sidebar-version"
            onClick={onShowAbout}
          >
            v{version}
          </Button>
        )}
        <Button
          variant="plain"
          aria-label={toggleLabel}
          aria-expanded={!collapsed}
          title={toggleLabel}
          className="sidebar-item sidebar-toggle"
          onClick={onToggleCollapsed}
        >
          <SidebarToggleIcon collapsed={collapsed} />
        </Button>
      </div>
    </aside>
  );
}
