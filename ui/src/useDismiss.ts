import { type RefObject, useEffect } from "react";

/** Calls `onDismiss` on Escape or a pointer press outside `container`, while `active`. */
export function useDismiss(active: boolean, container: RefObject<HTMLElement | null>, onDismiss: () => void) {
  useEffect(() => {
    if (!active) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onDismiss();
    }
    function onPointerDown(event: PointerEvent) {
      if (!container.current?.contains(event.target as Node)) onDismiss();
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [active, container, onDismiss]);
}
