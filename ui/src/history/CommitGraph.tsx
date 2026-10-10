import type { Edge, HistoryRow } from "../core/api";
import { NODE_RADIUS, ROW_HEIGHT, categoryOf, graphWidth, laneX } from "./geometry";

const middle = ROW_HEIGHT / 2;

function path(edge: Edge, nodeLane: number): string {
  const lane = laneX(edge.lane);
  const node = laneX(nodeLane);
  switch (edge.kind) {
    case "through":
      return `M ${lane} 0 V ${ROW_HEIGHT}`;
    case "incoming":
      return `M ${lane} 0 C ${lane} ${middle} ${node} 0 ${node} ${middle}`;
    case "outgoing":
      return `M ${node} ${middle} C ${node} ${ROW_HEIGHT} ${lane} ${middle} ${lane} ${ROW_HEIGHT}`;
  }
}

export function CommitGraph({ row, laneCount }: { row: HistoryRow; laneCount: number }) {
  const isMerge = row.edges.filter((edge) => edge.kind === "outgoing").length > 1;
  return (
    <svg
      aria-hidden="true"
      className="graph"
      width={graphWidth(laneCount)}
      height={ROW_HEIGHT}
    >
      {row.edges.map((edge) => (
        <path
          key={`${edge.kind}-${edge.lane}`}
          data-edge={edge.kind}
          data-lane={edge.lane}
          className={`graph-line category-${categoryOf(edge.lane)}`}
          d={path(edge, row.lane)}
        />
      ))}
      <circle
        data-node
        data-lane={row.lane}
        data-merge={isMerge || undefined}
        className={`graph-node category-${categoryOf(row.lane)}`}
        cx={laneX(row.lane)}
        cy={middle}
        r={NODE_RADIUS}
      />
    </svg>
  );
}

export function DayGraph({ lanes, laneCount }: { lanes: number[]; laneCount: number }) {
  return (
    <svg aria-hidden="true" className="graph" width={graphWidth(laneCount)} height={ROW_HEIGHT}>
      {lanes.map((lane) => (
        <path
          key={lane}
          data-edge="through"
          data-lane={lane}
          className={`graph-line category-${categoryOf(lane)}`}
          d={path({ kind: "through", lane }, lane)}
        />
      ))}
    </svg>
  );
}
