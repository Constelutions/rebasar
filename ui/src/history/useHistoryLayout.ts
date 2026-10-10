import { useState } from "react";

import type { GraphStyle, Orientation } from "./geometry";

export interface HistoryLayout {
  orientation: Orientation;
  style: GraphStyle;
}

const STORAGE_KEY = "rebasar.history.layout";
const defaults: HistoryLayout = { orientation: "vertical", style: "tree" };

function isOrientation(value: unknown): value is Orientation {
  return value === "vertical" || value === "horizontal";
}

function isStyle(value: unknown): value is GraphStyle {
  return value === "tree" || value === "linear";
}

function load(): HistoryLayout {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (typeof stored !== "object" || stored === null) return defaults;
    const { orientation, style } = stored as Record<string, unknown>;
    return {
      orientation: isOrientation(orientation) ? orientation : defaults.orientation,
      style: isStyle(style) ? style : defaults.style,
    };
  } catch {
    return defaults;
  }
}

function save(layout: HistoryLayout) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  } catch {
    // The choice then only lasts until the view is closed, which is no reason to fail.
  }
}

/** The user's orientation and graph style, kept across sessions. */
export function useHistoryLayout() {
  const [layout, setLayout] = useState(load);

  function change(changes: Partial<HistoryLayout>) {
    const next = { ...layout, ...changes };
    setLayout(next);
    save(next);
  }

  return [layout, change] as const;
}
