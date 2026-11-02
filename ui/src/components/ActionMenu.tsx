import {
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { useDismiss } from "../useDismiss";
import { Button } from "./Button";

export interface MenuItem {
  key: string;
  label: string;
  run?: () => void;
  /** Items that open a nested list of choices instead of running. */
  submenu?: MenuItem[];
  destructive?: boolean;
  disabled?: boolean;
  title?: string;
  current?: boolean;
  /** Draws a divider above the item. */
  separated?: boolean;
}

interface ActionMenuProps {
  label: string;
  items: MenuItem[];
  /** The viewport position the menu opens at. */
  x: number;
  y: number;
  onClose: () => void;
}

/**
 * The one menu of the app: secondary actions of a row or a header live here, opened by an options
 * button or a right-click. Fixed to the viewport because scrolling lists would clip it.
 */
export function ActionMenu({ label, items, x, y, onClose }: ActionMenuProps) {
  const menu = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [position, setPosition] = useState({ left: x, top: y });
  useDismiss(true, menu, onClose);

  useLayoutEffect(() => {
    const box = menu.current?.getBoundingClientRect();
    if (!box) return;
    setPosition({
      left: Math.max(4, Math.min(x, window.innerWidth - box.width - 4)),
      top: Math.max(4, Math.min(y, window.innerHeight - box.height - 4)),
    });
  }, [x, y, expanded]);

  useLayoutEffect(() => {
    const opener = document.activeElement;
    menu.current?.querySelector<HTMLElement>("[role=menuitem]:not(:disabled)")?.focus();
    return () => {
      if (opener instanceof HTMLElement && document.activeElement === document.body) opener.focus();
    };
  }, []);

  function moveFocus(offset: number) {
    const buttons = [...(menu.current?.querySelectorAll<HTMLElement>("[role=menuitem]:not(:disabled)") ?? [])];
    const current = buttons.indexOf(document.activeElement as HTMLElement);
    buttons[(current + offset + buttons.length) % buttons.length]?.focus();
  }

  function onKeyDown(event: ReactKeyboardEvent) {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      moveFocus(event.key === "ArrowDown" ? 1 : -1);
    } else if (event.key === "ArrowLeft" && expanded !== null) {
      event.preventDefault();
      setExpanded(null);
    }
  }

  function choose(item: MenuItem) {
    if (item.submenu) {
      setExpanded((current) => (current === item.key ? null : item.key));
      return;
    }
    onClose();
    item.run?.();
  }

  function renderItem(item: MenuItem, nested: boolean) {
    const open = expanded === item.key;
    return (
      <div key={item.key} role="none" className={item.separated ? "menu-separated" : undefined}>
        <Button
          variant="plain"
          type="button"
          role="menuitem"
          aria-haspopup={item.submenu ? "menu" : undefined}
          aria-expanded={item.submenu ? open : undefined}
          aria-current={item.current || undefined}
          disabled={item.disabled}
          title={item.title}
          className={["menu-item", item.destructive ? "danger" : "", nested ? "menu-nested" : ""]
            .filter(Boolean)
            .join(" ")}
          onClick={() => choose(item)}
          onKeyDown={(event) => {
            if (item.submenu && event.key === "ArrowRight") {
              event.preventDefault();
              setExpanded(item.key);
            }
          }}
        >
          {item.label}
        </Button>
        {open && item.submenu && (
          <div role="menu" aria-label={item.label} className="menu-submenu">
            {item.submenu.map((child) => renderItem(child, true))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div ref={menu} role="menu" aria-label={label} className="context-menu" style={position} onKeyDown={onKeyDown}>
      {items.map((item) => renderItem(item, false))}
    </div>
  );
}

export interface OpenActionMenu {
  x: number;
  y: number;
}

/** State and handlers for a surface that opens an `ActionMenu` from a button or a right-click. */
export function useActionMenu() {
  const [open, setOpen] = useState<OpenActionMenu | null>(null);
  const close = useCallback(() => setOpen(null), []);

  const openFromButton = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    event.stopPropagation();
    const box = event.currentTarget.getBoundingClientRect();
    setOpen({ x: box.left, y: box.bottom });
  }, []);

  const openFromContextMenu = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setOpen({ x: event.clientX, y: event.clientY });
  }, []);

  return { open, close, openFromButton, openFromContextMenu };
}

interface OptionsButtonProps {
  label: string;
  expanded: boolean;
  onClick: (event: ReactMouseEvent<HTMLElement>) => void;
}

/** The `⋯` button that opens a row's `ActionMenu`. */
export function OptionsButton({ label, expanded, onClick }: OptionsButtonProps) {
  return (
    <Button
      variant="plain"
      type="button"
      aria-label={label}
      aria-haspopup="menu"
      aria-expanded={expanded}
      title={label}
      className="options-button"
      onClick={onClick}
    >
      <svg viewBox="0 0 16 16" aria-hidden="true" className="options-icon">
        <circle cx="3.5" cy="8" r="1.2" />
        <circle cx="8" cy="8" r="1.2" />
        <circle cx="12.5" cy="8" r="1.2" />
      </svg>
    </Button>
  );
}
