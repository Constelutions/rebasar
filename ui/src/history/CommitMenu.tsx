import { useEffect, useRef } from "react";

export type CommitAction =
  | "checkout"
  | "createBranch"
  | "createTag"
  | "copyHash"
  | "reword"
  | "compare"
  | "rebase"
  | "cherryPick"
  | "revert"
  | "resetSoft"
  | "resetMixed"
  | "resetHard";

const items: { action: CommitAction; label: string }[] = [
  { action: "checkout", label: "Checkout (detached)" },
  { action: "createBranch", label: "Create branch here…" },
  { action: "createTag", label: "Create tag here…" },
  { action: "copyHash", label: "Copy hash" },
  { action: "reword", label: "Reword…" },
  { action: "compare", label: "Compare with working tree" },
  { action: "rebase", label: "Interactive rebase from here…" },
  { action: "cherryPick", label: "Cherry-pick" },
  { action: "revert", label: "Revert" },
  { action: "resetSoft", label: "Reset soft to here" },
  { action: "resetMixed", label: "Reset mixed to here" },
  { action: "resetHard", label: "Reset hard to here" },
];

interface CommitMenuProps {
  x: number;
  y: number;
  onSelect: (action: CommitAction) => void;
  onClose: () => void;
}

export function CommitMenu({ x, y, onSelect, onClose }: CommitMenuProps) {
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const opener = document.activeElement;
    menu.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!menu.current?.contains(event.target as Node)) onClose();
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      if (opener instanceof HTMLElement && document.activeElement === document.body) opener.focus();
    };
  }, [onClose]);

  function moveFocus(offset: number) {
    const buttons = [...(menu.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];
    const current = buttons.indexOf(document.activeElement as HTMLElement);
    buttons[(current + offset + buttons.length) % buttons.length]?.focus();
  }

  return (
    <div
      ref={menu}
      role="menu"
      aria-label="Commit actions"
      className="context-menu"
      style={{ left: x, top: y }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          onClose();
        } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          moveFocus(event.key === "ArrowDown" ? 1 : -1);
        }
      }}
    >
      {items.map(({ action, label }) => (
        <button key={action} type="button" role="menuitem" onClick={() => onSelect(action)}>
          {label}
        </button>
      ))}
    </div>
  );
}
