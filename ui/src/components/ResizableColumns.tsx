import { type KeyboardEvent, type PointerEvent, type ReactNode, useRef, useState } from "react";

const DEFAULT_RATIO = 0.4;
const MIN_RATIO = 0.2;
const MAX_RATIO = 0.7;
const KEY_STEP = 0.04;

interface ResizableColumnsProps {
  label: string;
  start: ReactNode;
  end: ReactNode;
  className?: string;
}

/** Two columns with a draggable divider; the start column keeps its share of the width as the pane resizes. */
export function ResizableColumns({ label, start, end, className }: ResizableColumnsProps) {
  const container = useRef<HTMLDivElement>(null);
  const [ratio, setRatio] = useState(DEFAULT_RATIO);
  const drag = useRef<{ pointerX: number; ratio: number } | null>(null);

  function resize(next: number) {
    setRatio(Math.min(MAX_RATIO, Math.max(MIN_RATIO, next)));
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const origin = drag.current;
    const width = container.current?.clientWidth ?? 0;
    if (!origin || width === 0) return;
    resize(origin.ratio + (event.clientX - origin.pointerX) / width);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowLeft") resize(ratio - KEY_STEP);
    else if (event.key === "ArrowRight") resize(ratio + KEY_STEP);
    else return;
    event.preventDefault();
  }

  return (
    <div ref={container} className={className ? `resizable-columns ${className}` : "resizable-columns"}>
      <div className="resizable-start" style={{ flexBasis: `${ratio * 100}%` }}>
        {start}
      </div>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={label}
        aria-valuemin={MIN_RATIO * 100}
        aria-valuemax={MAX_RATIO * 100}
        aria-valuenow={Math.round(ratio * 100)}
        tabIndex={0}
        className="resizable-handle"
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture?.(event.pointerId);
          drag.current = { pointerX: event.clientX, ratio };
        }}
        onPointerMove={onPointerMove}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
        onKeyDown={onKeyDown}
      />
      <div className="resizable-end">{end}</div>
    </div>
  );
}
