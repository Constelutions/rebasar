import {
  type CSSProperties,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { useSettings } from "./settings/SettingsContext";

/** Long enough that a double or triple click, or a drag, settles before anything is copied. */
export const COPY_DEBOUNCE_MS = 300;
export const COPIED_TOOLTIP_MS = 1500;

export interface CopyOnSelect<T extends HTMLElement> {
  /** Put on the one element whose selected text is copied; selections elsewhere are ignored. */
  ref: RefObject<T | null>;
  /** Render it once, anywhere; it shows "Copied" for a moment after each copy. */
  tooltip: ReactNode;
  /** Copies `text` and shows the tooltip above `near`, for surfaces that copy on click. */
  copy: (text: string, near: Element) => void;
}

/**
 * Copies the text selected inside `ref` once the selection stops changing, when the Copy on
 * select setting is on. For the Output panel, file paths and commit hashes only: never for
 * diffs, commit messages or the commit composer.
 */
export function useCopyOnSelect<T extends HTMLElement = HTMLElement>(): CopyOnSelect<T> {
  const enabled = useSettings().settings.copy.onSelect;
  const ref = useRef<T>(null);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(hideTimer.current), []);

  const copyAt = useCallback(async (text: string, at: Anchor) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      return;
    }
    setAnchor(at);
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setAnchor(null), COPIED_TOOLTIP_MS);
  }, []);

  const copy = useCallback(
    (text: string, near: Element) => void copyAt(text, anchorAbove(near.getBoundingClientRect())),
    [copyAt],
  );

  useEffect(() => {
    if (!enabled) return;
    let pending: ReturnType<typeof setTimeout> | undefined;

    function onSelectionChange() {
      clearTimeout(pending);
      const surface = ref.current;
      const selection = document.getSelection();
      if (!surface || !selection || selection.isCollapsed) return;
      if (!surface.contains(selection.anchorNode)) return;
      pending = setTimeout(() => {
        const text = selection.toString();
        if (text !== "") void copyAt(text, anchorAbove(surface.getBoundingClientRect()));
      }, COPY_DEBOUNCE_MS);
    }

    document.addEventListener("selectionchange", onSelectionChange);
    return () => {
      document.removeEventListener("selectionchange", onSelectionChange);
      clearTimeout(pending);
    };
  }, [enabled, copyAt]);

  const tooltip = anchor && (
    <span role="tooltip" className="copied-tooltip" style={anchor}>
      Copied
    </span>
  );

  return { ref, tooltip, copy };
}

type Anchor = Pick<CSSProperties, "left" | "top">;

function anchorAbove(rect: DOMRect): Anchor {
  return { left: rect.left + rect.width / 2, top: rect.top };
}
