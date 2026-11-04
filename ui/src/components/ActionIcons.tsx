import type { ReactNode } from "react";

const icons = {
  fetch: <path d="M13.5 8a5.5 5.5 0 1 1-1.7-4M13.5 2.5v3h-3" />,
  pull: <path d="M8 2.5v8M4.5 7 8 10.5 11.5 7M3 13.5h10" />,
  push: <path d="M8 13.5v-8M4.5 9 8 5.5 11.5 9M3 2.5h10" />,
  close: <path d="m4 4 8 8M12 4l-8 8" />,
  openIn: <path d="m5.5 4.5-3.5 3.5 3.5 3.5M10.5 4.5 14 8l-3.5 3.5" />,
} satisfies Record<string, ReactNode>;

export type ActionIconName = keyof typeof icons;

export function ActionIcon({ name }: { name: ActionIconName }) {
  return (
    <svg className="action-icon" viewBox="0 0 16 16" aria-hidden="true">
      {icons[name]}
    </svg>
  );
}
