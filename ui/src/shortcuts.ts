import { useEffect, useEffectEvent } from "react";

interface Shortcut {
  key: string;
  label: string;
}

/** Every shortcut is Ctrl-based: the mockup's Command key maps to Ctrl on Windows and Linux. */
export const shortcuts = {
  openFolder: { key: "o", label: "Ctrl+O" },
  openSettings: { key: ",", label: "Ctrl+," },
  commandPalette: { key: "p", label: "Ctrl+P" },
} satisfies Record<string, Shortcut>;

export function useShortcut(shortcut: Shortcut, handler: () => void) {
  const onShortcut = useEffectEvent(handler);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
      if (event.key.toLowerCase() !== shortcut.key) return;
      event.preventDefault();
      onShortcut();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [shortcut.key]);
}
