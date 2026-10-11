export type Orientation = "vertical" | "horizontal";
export type GraphStyle = "tree" | "linear";

export const ROW_HEIGHT = 36;
/** Wide enough for the commit's message to wrap over a few lines under its part of the graph. */
export const COLUMN_WIDTH = 220;
export const LANE_WIDTH = 16;
export const NODE_RADIUS = 4.5;
export const CATEGORY_COUNT = 8;
/** Wider graphs are clipped, so one very parallel stretch of history cannot push the commit text off screen. */
export const MAX_VISIBLE_LANES = 12;

/** The room one history item takes along the direction the history runs. */
export function itemSize(orientation: Orientation): number {
  return orientation === "vertical" ? ROW_HEIGHT : COLUMN_WIDTH;
}

export function laneX(lane: number): number {
  return lane * LANE_WIDTH + LANE_WIDTH / 2;
}

/** The room the lanes take across the direction the history runs. */
export function graphWidth(laneCount: number): number {
  return Math.min(laneCount, MAX_VISIBLE_LANES) * LANE_WIDTH;
}

/** A stable colour slot for a lane or an author, so the same one always looks the same. */
export function categoryOf(value: number | string): number {
  if (typeof value === "number") return value % CATEGORY_COUNT;
  let hash = 0;
  for (const char of value) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash % CATEGORY_COUNT;
}
