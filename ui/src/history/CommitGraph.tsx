import type { Edge, HistoryRow } from "../core/api";
import {
  type GraphStyle,
  NODE_RADIUS,
  type Orientation,
  categoryOf,
  graphWidth,
  itemSize,
  laneX,
} from "./geometry";

/** Whether the line of a linear graph continues past the commit's top and bottom edge. */
export interface Connections {
  above: boolean;
  below: boolean;
}

interface GraphProps {
  orientation: Orientation;
  style: GraphStyle;
  laneCount: number;
}

/** Draws in lane (across) and run (along the history) coordinates; the orientation decides which is x. */
function pointer(orientation: Orientation) {
  return (across: number, along: number) =>
    orientation === "vertical" ? `${across} ${along}` : `${along} ${across}`;
}

function path(edge: Edge, nodeLane: number, orientation: Orientation): string {
  const at = pointer(orientation);
  const length = itemSize(orientation);
  const middle = length / 2;
  const lane = laneX(edge.lane, orientation);
  const node = laneX(nodeLane, orientation);
  switch (edge.kind) {
    case "through":
      return `M ${at(lane, 0)} L ${at(lane, length)}`;
    case "incoming":
      return `M ${at(lane, 0)} C ${at(lane, middle)} ${at(node, 0)} ${at(node, middle)}`;
    case "outgoing":
      return `M ${at(node, middle)} C ${at(node, length)} ${at(lane, middle)} ${at(lane, length)}`;
  }
}

function linearEdges({ above, below }: Connections): Edge[] {
  if (above && below) return [{ kind: "through", lane: 0 }];
  if (above) return [{ kind: "incoming", lane: 0 }];
  if (below) return [{ kind: "outgoing", lane: 0 }];
  return [];
}

function Canvas({
  orientation,
  laneCount,
  children,
}: Pick<GraphProps, "orientation" | "laneCount"> & { children: React.ReactNode }) {
  const lanes = graphWidth(laneCount, orientation);
  const run = itemSize(orientation);
  return (
    <svg
      aria-hidden="true"
      className="graph"
      width={orientation === "vertical" ? lanes : run}
      height={orientation === "vertical" ? run : lanes}
    >
      {children}
    </svg>
  );
}

function Line({ edge, nodeLane, orientation }: { edge: Edge; nodeLane: number; orientation: Orientation }) {
  return (
    <path
      data-edge={edge.kind}
      data-lane={edge.lane}
      className={`graph-line category-${categoryOf(edge.lane)}`}
      d={path(edge, nodeLane, orientation)}
    />
  );
}

export function CommitGraph({
  row,
  connections,
  orientation,
  style,
  laneCount,
}: GraphProps & { row: HistoryRow; connections: Connections }) {
  const isMerge = row.edges.filter((edge) => edge.kind === "outgoing").length > 1;
  const linear = style === "linear";
  const lane = linear ? 0 : row.lane;
  const edges = linear ? linearEdges(connections) : row.edges;
  const across = laneX(lane, orientation);
  const along = itemSize(orientation) / 2;
  return (
    <Canvas orientation={orientation} laneCount={linear ? 1 : laneCount}>
      {edges.map((edge) => (
        <Line key={`${edge.kind}-${edge.lane}`} edge={edge} nodeLane={lane} orientation={orientation} />
      ))}
      <circle
        data-node
        data-lane={lane}
        data-merge={isMerge || undefined}
        className={`graph-node category-${categoryOf(linear ? row.authorEmail : lane)}`}
        cx={orientation === "vertical" ? across : along}
        cy={orientation === "vertical" ? along : across}
        r={NODE_RADIUS}
      />
    </Canvas>
  );
}

export function DayGraph({ lanes, orientation, style, laneCount }: GraphProps & { lanes: number[] }) {
  const linear = style === "linear";
  const shown = linear ? (lanes.length > 0 ? [0] : []) : lanes;
  return (
    <Canvas orientation={orientation} laneCount={linear ? 1 : laneCount}>
      {shown.map((lane) => (
        <Line key={lane} edge={{ kind: "through", lane }} nodeLane={lane} orientation={orientation} />
      ))}
    </Canvas>
  );
}
