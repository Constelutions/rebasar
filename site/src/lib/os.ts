export type DesktopOs = "Windows" | "Linux";

export interface PlatformInfo {
  platform: string;
  userAgent: string;
  userAgentData?: { platform: string } | undefined;
}

// Returns null for platforms without an installer, so the page keeps its default highlight.
export function detectOs({ platform, userAgent, userAgentData }: PlatformInfo): DesktopOs | null {
  const hints = `${userAgentData?.platform ?? ""} ${platform} ${userAgent}`;
  if (/android|iphone|ipad|ipod/i.test(hints)) return null;
  if (/win/i.test(hints) && !/darwin/i.test(hints)) return "Windows";
  if (/linux|x11/i.test(hints)) return "Linux";
  return null;
}
