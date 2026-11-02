const paths = {
  down: "M3.5 6 8 10.5 12.5 6",
  up: "M3.5 10 8 5.5 12.5 10",
  right: "M6 3.5 10.5 8 6 12.5",
  left: "M10 3.5 5.5 8 10 12.5",
} as const;

export type ChevronDirection = keyof typeof paths;

/** A disclosure arrow drawn as a stroked path, large enough to tell open from closed at a glance. */
export function ChevronIcon({ direction }: { direction: ChevronDirection }) {
  return (
    <svg className="chevron-icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d={paths[direction]} />
    </svg>
  );
}
