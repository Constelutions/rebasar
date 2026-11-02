import { useSettings } from "../settings/SettingsContext";
import type { GraphStyle, Orientation } from "./geometry";

export interface HistoryLayout {
  orientation: Orientation;
  style: GraphStyle;
}

/** The user's orientation and graph style, which live in the settings so they survive restarts. */
export function useHistoryLayout() {
  const { settings, update } = useSettings();
  const { orientation } = settings.history;
  const style = orientation === "horizontal" ? "tree" : settings.history.graphStyle;

  function change(changes: Partial<HistoryLayout>) {
    const next = { orientation, style, ...changes };
    if (next.orientation === "horizontal") next.style = "tree";
    update({
      ...settings,
      history: { ...settings.history, orientation: next.orientation, graphStyle: next.style },
    });
  }

  return [{ orientation, style }, change] as const;
}
