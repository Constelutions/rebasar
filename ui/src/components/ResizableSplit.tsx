import { type KeyboardEvent, type PointerEvent, type ReactNode, useRef } from "react";

import { useSplitRatio } from "./splitSizes";

export type SplitAxis = "row" | "column";

const DEFAULT_RATIO = 0.4;
const MIN_RATIO = 0.2;
const MAX_RATIO = 0.7;
const KEY_STEP = 0.04;

const axes = {
  row: { pointer: "clientX", size: "clientWidth", grow: "ArrowRight", shrink: "ArrowLeft", orientation: "vertical" },
  column: { pointer: "clientY", size: "clientHeight", grow: "ArrowDown", shrink: "ArrowUp", orientation: "horizontal" },
} as const;

interface ResizableSplitProps {
  label: string;
  axis: SplitAxis;
  start: ReactNode;
  /** The pane beside the start; without one the start fills the space and there is no divider. */
  end?: ReactNode;
  className?: string;
  /** Keeps the size for the session under this key; without one the size is lost when the split unmounts. */
  sizeKey?: string;
  /** Exposed as `data-position` for styling that depends on where the end pane sits. */
  position?: string;
}

/** Two panes with a draggable divider along either axis; the start pane keeps its share as the container resizes. */
export function ResizableSplit({ label, axis, start, end, className, sizeKey, position }: ResizableSplitProps) {
  const container = useRef<HTMLDivElement>(null);
  const [ratio, setRatio] = useSplitRatio(sizeKey, DEFAULT_RATIO);
  const drag = useRef<{ pointer: number; ratio: number } | null>(null);
  const { pointer, size, grow, shrink, orientation } = axes[axis];

  function resize(next: number) {
    setRatio(Math.min(MAX_RATIO, Math.max(MIN_RATIO, next)));
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const origin = drag.current;
    const extent = container.current?.[size] ?? 0;
    if (!origin || extent === 0) return;
    resize(origin.ratio + (event[pointer] - origin.pointer) / extent);
  }

  function endDrag() {
    drag.current = null;
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === grow) resize(ratio + KEY_STEP);
    else if (event.key === shrink) resize(ratio - KEY_STEP);
    else return;
    event.preventDefault();
  }

  const hasEnd = Boolean(end);

  return (
    <div
      ref={container}
      className={className ? `resizable-split ${className}` : "resizable-split"}
      data-axis={axis}
      data-open={hasEnd ? true : undefined}
      data-position={position}
    >
      <div className="resizable-start" style={hasEnd ? { flexBasis: `${ratio * 100}%` } : undefined}>
        {start}
      </div>
      {hasEnd && (
        <>
          <div
            role="separator"
            aria-orientation={orientation}
            aria-label={label}
            aria-valuemin={MIN_RATIO * 100}
            aria-valuemax={MAX_RATIO * 100}
            aria-valuenow={Math.round(ratio * 100)}
            tabIndex={0}
            className="resizable-handle"
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture?.(event.pointerId);
              drag.current = { pointer: event[pointer], ratio };
            }}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onDoubleClick={() => resize(DEFAULT_RATIO)}
            onKeyDown={onKeyDown}
          />
          <div className="resizable-end">{end}</div>
        </>
      )}
    </div>
  );
}
