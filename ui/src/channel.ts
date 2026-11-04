export type Channel = "Beta" | "Stable";

/** Mirrors the release rule of ADR-0004: only a plain `1.x.y` or later is Stable, so no build flag is needed. */
export function channelOf(version: string): Channel {
  return /^[1-9]\d*\.\d+\.\d+$/.test(version) ? "Stable" : "Beta";
}
