import { type ViewName, viewGroups } from "../views";
import { Button } from "./Button";

interface SidebarProps {
  selected: ViewName;
  onSelect: (view: ViewName) => void;
}

export function Sidebar({ selected, onSelect }: SidebarProps) {
  return (
    <nav aria-label="Views" className="sidebar">
      {viewGroups.map((group) => (
        <div key={group[0]} className="sidebar-group">
          {group.map((view) => (
            <Button
              variant="plain"
              key={view}
              type="button"
              aria-current={view === selected ? "page" : undefined}
              className="sidebar-item"
              onClick={() => onSelect(view)}
            >
              {view}
            </Button>
          ))}
        </div>
      ))}
    </nav>
  );
}
