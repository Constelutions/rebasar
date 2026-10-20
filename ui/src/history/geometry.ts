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

/** Horizontal lanes are rows, so they sit further apart than the narrow columns of a vertical history. */
export const LANE_HEIGHT = 24;
/** What a horizontal history keeps below its lanes for the commit's message, author and labels. */
export const HORIZONTAL_CARD_HEIGHT = 128;

function lanePitch(orientation: Orientation): number {
  return orientation === "vertical" ? LANE_WIDTH : LANE_HEIGHT;
}

export function laneX(lane: number, orientation: Orientation): number {
  const pitch = lanePitch(orientation);
  return lane * pitch + pitch / 2;
}

/**
 * The room the lanes take across the direction the history runs. A vertical history clips its
 * lanes; a horizontal one shows them all and scrolls.
 */
export function graphWidth(laneCount: number, orientation: Orientation): number {
  const shown = orientation === "vertical" ? Math.min(laneCount, MAX_VISIBLE_LANES) : laneCount;
  return shown * lanePitch(orientation);
}

/** How tall a horizontal history is at least, so it scrolls instead of squeezing the commit text. */
export function minimumHeight(laneCount: number): number {
  return graphWidth(laneCount, "horizontal") + HORIZONTAL_CARD_HEIGHT;
}

/** A stable colour slot for a lane or an author, so the same one always looks the same. */
export function categoryOf(value: number | string): number {
  if (typeof value === "number") return value % CATEGORY_COUNT;
  let hash = 0;
  for (const char of value) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash % CATEGORY_COUNT;
}
