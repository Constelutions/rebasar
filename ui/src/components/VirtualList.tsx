import { type ReactNode, useEffect, useRef, useState } from "react";

/** Used until the container reports a height, as it never does in a test DOM. */
const FALLBACK_VIEWPORT_HEIGHT = 600;
const OVERSCAN_ROWS = 6;

interface VirtualListProps<T> {
  items: readonly T[];
  rowHeight: number;
  label: string;
  className?: string;
  getKey: (item: T, index: number) => string;
  renderRow: (item: T, index: number) => ReactNode;
}

/** Renders only the rows in view, so a list of thousands of rows costs the same as a short one. */
export function VirtualList<T>({
  items,
  rowHeight,
  label,
  className,
  getKey,
  renderRow,
}: VirtualListProps<T>) {
  const container = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(FALLBACK_VIEWPORT_HEIGHT);

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const measure = () => setViewportHeight(element.clientHeight || FALLBACK_VIEWPORT_HEIGHT);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const first = Math.max(0, Math.floor(scrollTop / rowHeight) - OVERSCAN_ROWS);
  const last = Math.min(
    items.length,
    Math.ceil((scrollTop + viewportHeight) / rowHeight) + OVERSCAN_ROWS,
  );

  return (
    <div
      ref={container}
      role="list"
      aria-label={label}
      className={className ? `virtual-list ${className}` : "virtual-list"}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
    >
      <div className="virtual-list-body" style={{ height: items.length * rowHeight }}>
        {items.slice(first, last).map((item, offset) => {
          const index = first + offset;
          return (
            <div
              key={getKey(item, index)}
              role="listitem"
              className="virtual-row"
              style={{ top: index * rowHeight, height: rowHeight }}
            >
              {renderRow(item, index)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
