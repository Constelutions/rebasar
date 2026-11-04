import type { ReactNode } from "react";

import type { SplitPosition } from "../core/api";
import { ResizableSplit } from "./ResizableSplit";
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
  label: string;
  /** Names the view, so each view keeps its own split size for the session. */
  sizeKey: string;
  position: SplitPosition;
  /** The pane that opens beside the content; none leaves the content to fill the space. */
  secondary?: ReactNode;
  children: ReactNode;
}

export function SplitPane({ className, label, sizeKey, position, secondary, children }: SplitPaneProps) {
  return (
    <ResizableSplit
      className={className ? `split-pane ${className}` : "split-pane"}
      label={label}
      sizeKey={sizeKey}
      axis={position === "bottom" ? "column" : "row"}
      position={position}
      start={<div className="split-primary">{children}</div>}
      end={secondary}
    />
  );
}
