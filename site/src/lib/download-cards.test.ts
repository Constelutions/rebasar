import { describe, expect, it } from "vitest";
import { buildCards, ctaLinks } from "./download-cards";
import { RELEASES_URL, type ReleaseDownloads } from "./releases";

const asset = (name: string) => ({ name, url: `https://example.test/${name}` });

const downloads: ReleaseDownloads = {
  version: "0.2.0",
  releaseUrl: "https://example.test/releases/tag/v0.2.0",
  windows: asset("Rebasar_0.2.0_x64-setup.exe"),
  deb: asset("Rebasar_0.2.0_amd64.deb"),
  appImage: asset("Rebasar_0.2.0_amd64.AppImage"),
  checksums: asset("SHA256SUMS"),
};

describe("buildCards", () => {
  it("links each card to the real asset of the release", () => {
    const [windows, deb, appImage] = buildCards(downloads);

    expect(windows).toMatchObject({ file: "Rebasar_0.2.0_x64-setup.exe", href: "https://example.test/Rebasar_0.2.0_x64-setup.exe" });
    expect(deb).toMatchObject({ file: "Rebasar_0.2.0_amd64.deb", href: "https://example.test/Rebasar_0.2.0_amd64.deb" });
    expect(appImage).toMatchObject({ file: "Rebasar_0.2.0_amd64.AppImage" });
  });

  it("names the installed file in the apt command", () => {
    expect(buildCards(downloads)[1]?.note).toContain("sudo apt install ./Rebasar_0.2.0_amd64.deb");
  });

  it("falls back to the releases page and a name pattern when the lookup failed", () => {
    const cards = buildCards(null);

    expect(cards.slice(0, 3).map((card) => card.href)).toEqual([RELEASES_URL, RELEASES_URL, RELEASES_URL]);
    expect(cards[0]?.file).toBe("Rebasar_<version>_x64-setup.exe");
  });

  it("falls back to the release page when only one asset is missing", () => {
    const cards = buildCards({ ...downloads, deb: null });

    expect(cards[1]?.href).toBe(downloads.releaseUrl);
    expect(cards[0]?.href).toBe("https://example.test/Rebasar_0.2.0_x64-setup.exe");
  });

  it("lists macOS last, without a download", () => {
    const macos = buildCards(downloads).at(-1);

    expect(macos).toMatchObject({ id: "macos", href: null, file: null });
  });
});

describe("ctaLinks", () => {
  it("points each platform at its recommended installer", () => {
    expect(ctaLinks(downloads)).toEqual({
      Windows: "https://example.test/Rebasar_0.2.0_x64-setup.exe",
      Linux: "https://example.test/Rebasar_0.2.0_amd64.deb",
    });
  });

  it("points both platforms at the releases page when the lookup failed", () => {
    expect(ctaLinks(null)).toEqual({ Windows: RELEASES_URL, Linux: RELEASES_URL });
  });
});
