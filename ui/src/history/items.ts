import type { HistoryRow } from "../core/api";

export type HistoryItem =
  | { kind: "day"; key: string; label: string; lanes: number[] }
  | { kind: "commit"; row: HistoryRow };

const dayFormat = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  year: "numeric",
  month: "long",
  day: "numeric",
});

const timeFormat = new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit" });

export function formatDay(timestamp: number): string {
  return dayFormat.format(timestamp * 1000);
}

export function formatTime(timestamp: number): string {
  return timeFormat.format(timestamp * 1000);
}

/**
 * Appends `rows` to `items`, opening a day heading whenever the local day changes. A heading
 * keeps the lines of the row above running through it so the graph stays unbroken.
 */
export function appendRows(items: HistoryItem[], rows: HistoryRow[]): HistoryItem[] {
  const appended = [...items];
  let previous = lastCommit(items);
  for (const row of rows) {
    const day = formatDay(row.timestamp);
    if (previous === null || formatDay(previous.timestamp) !== day) {
      appended.push({ kind: "day", key: `${day}:${row.id}`, label: day, lanes: continuingLanes(previous) });
    }
    appended.push({ kind: "commit", row });
    previous = row;
  }
  return appended;
}

function lastCommit(items: HistoryItem[]): HistoryRow | null {
  const last = items.at(-1);
  return last?.kind === "commit" ? last.row : null;
}

function continuingLanes(row: HistoryRow | null): number[] {
  if (row === null) return [];
  const lanes = row.edges.filter((edge) => edge.kind !== "incoming").map((edge) => edge.lane);
  return [...new Set(lanes)];
}
