import type { ReactNode } from "react";

import type { ViewName } from "../views";

const icons: Record<ViewName, ReactNode> = {
  Home: <path d="M2.5 8 8 3l5.5 5M4 7v6h8V7M6.5 13V9.5h3V13" />,
  Changes: <path d="M3 5.5h6M6 2.5v6M7 11.5h6" />,
  "Pull requests": (
    <>
      <circle cx="4" cy="3.5" r="1.5" />
      <circle cx="4" cy="12.5" r="1.5" />
      <circle cx="12" cy="12.5" r="1.5" />
      <path d="M4 5v6M12 11V7a2 2 0 0 0-2-2H8.5M10 3.5 8.5 5 10 6.5" />
    </>
  ),
  History: (
    <>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M8 5v3l2 1.5" />
    </>
  ),
  Conflicts: <path d="M8 2.5 14 13H2L8 2.5ZM8 6.5v3M8 11.2v.1" />,
  Worktrees: <path d="M2 4.5h4l1.2 1.5H14v6.5H2v-8ZM5 9.5h6" />,
  Branches: (
    <>
      <circle cx="4.5" cy="3.5" r="1.5" />
      <circle cx="4.5" cy="12.5" r="1.5" />
      <circle cx="11.5" cy="6" r="1.5" />
      <path d="M4.5 5v6M11.5 7.5c0 2-2 2.5-7 3.5" />
    </>
  ),
  Stashes: <path d="M2.5 3.5h11v3h-11v-3ZM3.5 6.5v6h9v-6M6.5 9h3" />,
  Repositories: (
    <>
      <ellipse cx="8" cy="4" rx="5" ry="2" />
      <path d="M3 4v8c0 1.1 2.2 2 5 2s5-.9 5-2V4M3 8c0 1.1 2.2 2 5 2s5-.9 5-2" />
    </>
  ),
  Settings: (
    <>
      <circle cx="8" cy="8" r="2" />
      <path d="M8 1.8v1.7M8 12.5v1.7M1.8 8h1.7M12.5 8h1.7M3.6 3.6l1.2 1.2M11.2 11.2l1.2 1.2M12.4 3.6l-1.2 1.2M4.8 11.2l-1.2 1.2" />
    </>
  ),
};

export function ViewIcon({ view }: { view: ViewName }) {
  return (
    <svg className="sidebar-icon" viewBox="0 0 16 16" aria-hidden="true">
      {icons[view]}
    </svg>
  );
}

export function SidebarToggleIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg className="sidebar-icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d={collapsed ? "M6 3.5 10.5 8 6 12.5" : "M10 3.5 5.5 8l4.5 4.5"} />
    </svg>
  );
}
