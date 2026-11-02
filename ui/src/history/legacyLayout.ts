import type { Settings } from "../core/api";

type Layout = Pick<Settings["history"], "orientation" | "graphStyle">;

/** Where History kept its layout before it moved into the settings file. */
const STORAGE_KEY = "rebasar.history.layout";

/**
 * The layout an earlier version stored in this browser, if any. A Horizontal and Linear one is
 * read as Horizontal and Tree, since that combination no longer exists.
 */
export function readLegacyHistoryLayout(): Layout | null {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (typeof stored !== "object" || stored === null) return null;
    const { orientation, style } = stored as Record<string, unknown>;
    if (orientation !== "vertical" && orientation !== "horizontal") return null;
    return { orientation, graphStyle: orientation === "horizontal" || style !== "linear" ? "tree" : "linear" };
  } catch {
    return null;
  }
}

/** Called once the layout is safe in the settings file, so it is carried over only once. */
export function forgetLegacyHistoryLayout() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing else reads the key, so leaving it behind is harmless.
  }
}
