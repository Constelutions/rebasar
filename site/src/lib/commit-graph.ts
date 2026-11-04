export interface GraphCommit {
  hash: string;
  message: string;
  lane: number;
  author: keyof typeof AUTHORS;
  age: string;
  parents: number[];
  refs?: [label: string, kind: RefKind][];
}

export type RefKind = "head" | "remote" | "pr" | "tag" | "local";

export interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
}

export const LANE_COLORS = [
  "oklch(0.75 0.13 150)",
  "oklch(0.75 0.13 250)",
  "oklch(0.75 0.13 60)",
  "oklch(0.75 0.13 320)",
];

export const AUTHORS = {
  Mara: ["MI", "oklch(0.52 0.12 350)"],
  Tomás: ["TR", "oklch(0.5 0.09 85)"],
  Jun: ["JP", "oklch(0.5 0.09 200)"],
  Sam: ["SO", "oklch(0.5 0.1 290)"],
} as const;

export const ROW_HEIGHT = 44;
const MID = ROW_HEIGHT / 2;
const laneX = (lane: number) => 22 + lane * 26;
export const avatarLeft = (lane: number) => 8 + laneX(lane) - 11;

// Each row owns the slice of every edge that crosses it, so rows can be drawn as independent SVGs.
export function layoutGraph(commits: GraphCommit[]): Segment[][] {
  const rows: Segment[][] = commits.map(() => []);
  const add = (row: number, x1: number, y1: number, x2: number, y2: number, color: string) =>
    rows[row]!.push({ x1, y1, x2, y2, color });

  commits.forEach((commit, from) =>
    commit.parents.forEach((to, parentIndex) => {
      const fromLane = commit.lane;
      const toLane = commits[to]!.lane;
      const fromColor = LANE_COLORS[fromLane]!;
      const toColor = LANE_COLORS[toLane]!;

      if (fromLane === toLane) {
        for (let row = from; row <= to; row++) {
          add(row, laneX(fromLane), row === from ? MID : 0, laneX(fromLane), row === to ? MID : ROW_HEIGHT, fromColor);
        }
      } else if (parentIndex > 0) {
        add(from, laneX(fromLane), MID, laneX(toLane), ROW_HEIGHT, toColor);
        for (let row = from + 1; row <= to; row++) {
          add(row, laneX(toLane), 0, laneX(toLane), row === to ? MID : ROW_HEIGHT, toColor);
        }
      } else {
        for (let row = from; row < to; row++) {
          if (row === to - 1) {
            if (row > from) add(row, laneX(fromLane), 0, laneX(fromLane), MID, fromColor);
            add(row, laneX(fromLane), MID, laneX(toLane), ROW_HEIGHT, fromColor);
          } else {
            add(row, laneX(fromLane), row === from ? MID : 0, laneX(fromLane), ROW_HEIGHT, fromColor);
          }
        }
      }
    }),
  );

  return rows;
}
