import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { useCopyOnSelect } from "../useCopyOnSelect";

/** Long enough to cross the gap between the text and its tooltip without the tooltip closing. */
export const TOOLTIP_LEAVE_MS = 120;
const SHOW_DELAY_MS = 350;

interface TruncatedTextProps {
  text: string;
  className?: string;
  /** Cuts from the start so the file name stays visible: the ellipsis replaces the leading directories. */
  path?: boolean;
}

/**
 * Text that ends in an ellipsis instead of overlapping its neighbours. When it is actually cut,
 * hovering it shows the full text in a tooltip the pointer can enter, so the text can be selected.
 */
export function TruncatedText({ text, className, path = false }: TruncatedTextProps) {
  const element = useRef<HTMLSpanElement>(null);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const showTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const leaveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(
    () => () => {
      clearTimeout(showTimer.current);
      clearTimeout(leaveTimer.current);
    },
    [],
  );

  const show = useCallback(() => {
    clearTimeout(leaveTimer.current);
    const target = element.current;
    if (!target || target.scrollWidth <= target.clientWidth) return;
    clearTimeout(showTimer.current);
    showTimer.current = setTimeout(() => setAnchor(target.getBoundingClientRect()), SHOW_DELAY_MS);
  }, []);

  const hide = useCallback(() => {
    clearTimeout(showTimer.current);
    leaveTimer.current = setTimeout(() => setAnchor(null), TOOLTIP_LEAVE_MS);
  }, []);

  const classes = ["truncate", path ? "truncate-path" : "", className ?? ""].filter(Boolean).join(" ");

  return (
    <span ref={element} className={classes} onMouseEnter={show} onMouseLeave={hide}>
      {path ? <bdi>{text}</bdi> : text}
      {anchor && (
        <TruncationTooltip anchor={anchor} onEnter={show} onLeave={hide}>
          {text}
        </TruncationTooltip>
      )}
    </span>
  );
}

interface TruncationTooltipProps {
  anchor: DOMRect;
  children: ReactNode;
  onEnter: () => void;
  onLeave: () => void;
}

function TruncationTooltip({ anchor, children, onEnter, onLeave }: TruncationTooltipProps) {
  const { ref, tooltip } = useCopyOnSelect<HTMLSpanElement>();
  const [position, setPosition] = useState({ left: anchor.left, top: anchor.bottom });

  useLayoutEffect(() => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    const left = Math.max(4, Math.min(anchor.left, window.innerWidth - box.width - 4));
    const below = anchor.bottom + 2;
    const top = below + box.height > window.innerHeight ? Math.max(4, anchor.top - box.height - 2) : below;
    setPosition({ left, top });
  }, [anchor, ref]);

  return createPortal(
    <span
      ref={ref}
      role="tooltip"
      className="truncation-tooltip"
      style={position}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      {children}
      {tooltip}
    </span>,
    document.body,
  );
}
