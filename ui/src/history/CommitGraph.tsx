import type { Edge, HistoryRow } from "../core/api";
import { type GraphStyle, NODE_RADIUS, ROW_HEIGHT, categoryOf, graphWidth, laneX } from "./geometry";

/** Whether the line of a linear graph continues past the commit's top and bottom edge. */
export interface Connections {
  above: boolean;
  below: boolean;
}

interface GraphProps {
  style: GraphStyle;
  laneCount: number;
}

function path(edge: Edge, nodeLane: number): string {
  const middle = ROW_HEIGHT / 2;
  const lane = laneX(edge.lane);
  const node = laneX(nodeLane);
  switch (edge.kind) {
    case "through":
      return `M ${lane} 0 L ${lane} ${ROW_HEIGHT}`;
    case "incoming":
      return `M ${lane} 0 C ${lane} ${middle} ${node} 0 ${node} ${middle}`;
    case "outgoing":
      return `M ${node} ${middle} C ${node} ${ROW_HEIGHT} ${lane} ${middle} ${lane} ${ROW_HEIGHT}`;
  }
}

function linearEdges({ above, below }: Connections): Edge[] {
  if (above && below) return [{ kind: "through", lane: 0 }];
  if (above) return [{ kind: "incoming", lane: 0 }];
  if (below) return [{ kind: "outgoing", lane: 0 }];
  return [];
}

function Canvas({ laneCount, children }: Pick<GraphProps, "laneCount"> & { children: React.ReactNode }) {
  return (
    <svg aria-hidden="true" className="graph" width={graphWidth(laneCount)} height={ROW_HEIGHT}>
      {children}
    </svg>
  );
}

function Line({ edge, nodeLane }: { edge: Edge; nodeLane: number }) {
  return (
    <path
      data-edge={edge.kind}
      data-lane={edge.lane}
      className={`graph-line category-${categoryOf(edge.lane)}`}
      d={path(edge, nodeLane)}
    />
  );
}

export function CommitGraph({
  row,
  connections,
  style,
  laneCount,
}: GraphProps & { row: HistoryRow; connections: Connections }) {
  const isMerge = row.edges.filter((edge) => edge.kind === "outgoing").length > 1;
  const linear = style === "linear";
  const lane = linear ? 0 : row.lane;
  const edges = linear ? linearEdges(connections) : row.edges;
  return (
    <Canvas laneCount={linear ? 1 : laneCount}>
      {edges.map((edge) => (
        <Line key={`${edge.kind}-${edge.lane}`} edge={edge} nodeLane={lane} />
      ))}
      <circle
        data-node
        data-lane={lane}
        data-merge={isMerge || undefined}
        className={`graph-node category-${categoryOf(linear ? row.authorEmail : lane)}`}
        cx={laneX(lane)}
        cy={ROW_HEIGHT / 2}
        r={NODE_RADIUS}
      />
    </Canvas>
  );
}

export function DayGraph({ lanes, style, laneCount }: GraphProps & { lanes: number[] }) {
  const linear = style === "linear";
  const shown = linear ? (lanes.length > 0 ? [0] : []) : lanes;
  return (
    <Canvas laneCount={linear ? 1 : laneCount}>
      {shown.map((lane) => (
        <Line key={lane} edge={{ kind: "through", lane }} nodeLane={lane} />
      ))}
    </Canvas>
  );
}
