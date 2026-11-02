import {
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import type { Head } from "../core/api";
import type { OpenTab } from "../useOpenTabs";
import { Button } from "./Button";
import { StatusDot } from "./StatusDot";

interface TabStripProps {
  tabs: OpenTab[];
  activePath: string | undefined;
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
}

interface Thumb {
  left: number;
  width: number;
}

export function TabStrip({ tabs, activePath, onSelect, onClose }: TabStripProps) {
  const strip = useRef<HTMLDivElement>(null);
  const { thumb, startDrag, drag, endDrag } = useOverlayScrollbar(strip, tabs.length);

  useEffect(() => {
    const list = strip.current;
    if (!list) return;
    function scrollSideways(event: WheelEvent) {
      if (!list || event.deltaX !== 0 || list.scrollWidth <= list.clientWidth) return;
      event.preventDefault();
      list.scrollLeft += event.deltaY;
    }
    list.addEventListener("wheel", scrollSideways, { passive: false });
    return () => list.removeEventListener("wheel", scrollSideways);
  }, []);

  useEffect(() => {
    strip.current?.querySelector<HTMLElement>('[data-selected="true"]')?.scrollIntoView?.({
      inline: "nearest",
      block: "nearest",
    });
  }, [activePath]);

  return (
    <div className="tab-strip-zone">
      <div ref={strip} role="tablist" className="tab-strip">
        {tabs.map(({ tab, status }) => (
          <div
            key={tab.worktreePath}
            className="tab"
            data-selected={tab.worktreePath === activePath}
          >
            <Button
              variant="plain"
              className="tab-close"
              aria-label={`Close ${tab.repositoryName} · ${describeHead(tab.head)}`}
              onClick={() => onClose(tab.worktreePath)}
            >
              ×
            </Button>
            <Button
              variant="plain"
              type="button"
              role="tab"
              aria-selected={tab.worktreePath === activePath}
              title={tab.worktreePath}
              className="tab-select"
              onClick={() => onSelect(tab.worktreePath)}
            >
              <StatusDot status={status} />
              <span className="tab-name">{tab.repositoryName}</span>
              <span className="tab-head">{describeHead(tab.head)}</span>
            </Button>
          </div>
        ))}
      </div>
      {thumb && (
        <div className="tab-scrollbar" aria-hidden="true">
          <div
            className="tab-scrollbar-thumb"
            style={{ left: thumb.left, width: thumb.width }}
            onPointerDown={startDrag}
            onPointerMove={drag}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          />
        </div>
      )}
    </div>
  );
}

/**
 * Draws the scrollbar of the Tab strip over its bottom edge instead of below it, so showing it never
 * changes the height of the Tabs. The native bar is hidden and this one appears while the pointer is over the strip.
 */
function useOverlayScrollbar(strip: RefObject<HTMLDivElement | null>, tabCount: number) {
  const [thumb, setThumb] = useState<Thumb | null>(null);
  const dragOrigin = useRef<{ pointerX: number; scrollLeft: number } | null>(null);

  const measure = useCallback(() => {
    const list = strip.current;
    if (!list || list.scrollWidth <= list.clientWidth) {
      setThumb(null);
      return;
    }
    const ratio = list.clientWidth / list.scrollWidth;
    const width = Math.max(24, list.clientWidth * ratio);
    const travel = list.clientWidth - width;
    const progress = list.scrollLeft / (list.scrollWidth - list.clientWidth);
    setThumb({ left: travel * progress, width });
  }, [strip]);

  useEffect(() => {
    const list = strip.current;
    if (!list) return;
    measure();
    list.addEventListener("scroll", measure);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(list);
    return () => {
      list.removeEventListener("scroll", measure);
      observer?.disconnect();
    };
  }, [strip, measure, tabCount]);

  const startDrag = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.currentTarget.setPointerCapture?.(event.pointerId);
      dragOrigin.current = { pointerX: event.clientX, scrollLeft: strip.current?.scrollLeft ?? 0 };
    },
    [strip],
  );

  const drag = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const list = strip.current;
      const origin = dragOrigin.current;
      if (!list || !origin || !thumb) return;
      const travel = list.clientWidth - thumb.width;
      const scrollable = list.scrollWidth - list.clientWidth;
      list.scrollLeft = origin.scrollLeft + ((event.clientX - origin.pointerX) / travel) * scrollable;
    },
    [strip, thumb],
  );

  const endDrag = useCallback(() => {
    dragOrigin.current = null;
  }, []);

  return { thumb, startDrag, drag, endDrag };
}

export function describeHead(head: Head): string {
  return head.kind === "branch" ? head.name : `detached at ${head.commit}`;
}
