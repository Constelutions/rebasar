import { describe, expect, it } from "vitest";
import { detectOs } from "./os";

describe("detectOs", () => {
  it.each([
    ["Windows", "Windows", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130"],
    ["Linux", "Linux x86_64", "Mozilla/5.0 (X11; Linux x86_64) Firefox/130"],
    ["Linux", "", "Mozilla/5.0 (X11; Ubuntu; Linux x86_64) Firefox/130"],
  ] as const)("recognises %s", (expected, platform, userAgent) => {
    expect(detectOs({ platform, userAgent })).toBe(expected);
  });

  it("prefers the userAgentData platform when the browser offers it", () => {
    expect(
      detectOs({ platform: "", userAgent: "", userAgentData: { platform: "Windows" } }),
    ).toBe("Windows");
  });

  it.each([
    ["macOS", "MacIntel", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"],
    ["Android", "Linux armv81", "Mozilla/5.0 (Linux; Android 14; Pixel 8)"],
    ["iOS", "iPhone", "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)"],
  ])("returns null for %s, which has no installer yet", (_name, platform, userAgent) => {
    expect(detectOs({ platform, userAgent })).toBeNull();
  });
});
