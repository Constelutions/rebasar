import type { ReactNode } from "react";

import type { SplitPosition } from "../core/api";
import { SegmentedControl } from "./SegmentedControl";

const positionOptions = [
  { value: "right", label: "Right" },
  { value: "bottom", label: "Bottom" },
] as const;

interface SplitPositionToggleProps {
  label: string;
  value: SplitPosition;
  onChange: (position: SplitPosition) => void;
}

/** Chooses whether the pane that opens beside a list sits to its right or below it. */
export function SplitPositionToggle({ label, value, onChange }: SplitPositionToggleProps) {
  return <SegmentedControl label={label} options={positionOptions} value={value} onChange={onChange} />;
}

interface SplitPaneProps {
  className?: string;
  position: SplitPosition;
  /** The pane that opens beside the content; none leaves the content to fill the space. */
  secondary?: ReactNode;
  children: ReactNode;
}

export function SplitPane({ className, position, secondary, children }: SplitPaneProps) {
  return (
    <div className={className ? `split-pane ${className}` : "split-pane"} data-position={position} data-open={secondary ? true : undefined}>
      <div className="split-primary">{children}</div>
      {secondary}
    </div>
  );
}
