import { describe, expect, it } from "vitest";
import {
  RELEASES_URL,
  fetchDownloads,
  resolveDownloads,
  type ApiRelease,
} from "./releases";

const asset = (name: string) => ({
  name,
  browser_download_url: `https://github.com/Constelutions/rebasar/releases/download/v0/${name}`,
});

const release = (version: string, overrides: Partial<ApiRelease> = {}): ApiRelease => ({
  tag_name: `v${version}`,
  draft: false,
  prerelease: true,
  html_url: `https://github.com/Constelutions/rebasar/releases/tag/v${version}`,
  published_at: "2026-11-03T15:21:42Z",
  assets: [
    asset(`Rebasar_${version}_x64-setup.exe`),
    asset(`Rebasar_${version}_amd64.deb`),
    asset(`Rebasar_${version}_amd64.AppImage`),
    asset("SHA256SUMS"),
  ],
  ...overrides,
});

describe("resolveDownloads", () => {
  it("maps the three installers and the checksums file of a release", () => {
    const downloads = resolveDownloads([release("0.1.0")]);

    expect(downloads).toMatchObject({
      version: "0.1.0",
      releaseUrl: "https://github.com/Constelutions/rebasar/releases/tag/v0.1.0",
      windows: { name: "Rebasar_0.1.0_x64-setup.exe" },
      deb: { name: "Rebasar_0.1.0_amd64.deb" },
      appImage: { name: "Rebasar_0.1.0_amd64.AppImage" },
      checksums: { name: "SHA256SUMS" },
    });
    expect(downloads?.windows?.url).toContain("Rebasar_0.1.0_x64-setup.exe");
  });

  it("picks the newest published release, pre-releases included", () => {
    const downloads = resolveDownloads([
      release("0.1.0", { published_at: "2026-11-03T15:21:42Z" }),
      release("0.2.0", { published_at: "2026-12-01T09:00:00Z" }),
    ]);

    expect(downloads?.version).toBe("0.2.0");
  });

  it("skips drafts even when they are the newest", () => {
    const downloads = resolveDownloads([
      release("0.3.0", { draft: true, published_at: null }),
      release("0.2.0"),
    ]);

    expect(downloads?.version).toBe("0.2.0");
  });

  it("reports a missing asset as null and keeps the others", () => {
    const downloads = resolveDownloads([
      release("0.1.0", {
        assets: [asset("Rebasar_0.1.0_x64-setup.exe"), asset("SHA256SUMS")],
      }),
    ]);

    expect(downloads?.windows).not.toBeNull();
    expect(downloads?.deb).toBeNull();
    expect(downloads?.appImage).toBeNull();
  });

  it("ignores assets that belong to another version", () => {
    const downloads = resolveDownloads([
      release("0.2.0", { assets: [asset("Rebasar_0.1.0_x64-setup.exe")] }),
    ]);

    expect(downloads?.windows).toBeNull();
  });

  it("returns null when there is no published release", () => {
    expect(resolveDownloads([])).toBeNull();
    expect(resolveDownloads([release("0.1.0", { draft: true })])).toBeNull();
  });
});

describe("fetchDownloads", () => {
  const respond = (body: unknown, init: ResponseInit = {}) =>
    (async () => new Response(JSON.stringify(body), init)) as typeof fetch;

  it("resolves the releases the API lists", async () => {
    const downloads = await fetchDownloads({ fetch: respond([release("0.1.0")]) });

    expect(downloads?.version).toBe("0.1.0");
  });

  it("sends the token as a bearer credential when one is given", async () => {
    let seen: Headers | undefined;
    const spy = (async (_url: string | URL | Request, init?: RequestInit) => {
      seen = new Headers(init?.headers);
      return new Response("[]");
    }) as typeof fetch;

    await fetchDownloads({ fetch: spy, token: "secret" });

    expect(seen?.get("Authorization")).toBe("Bearer secret");
  });

  it("returns null when the API answers with an error status", async () => {
    expect(await fetchDownloads({ fetch: respond({}, { status: 403 }) })).toBeNull();
  });

  it("returns null when the request fails", async () => {
    const failing = (async () => {
      throw new Error("offline");
    }) as typeof fetch;

    expect(await fetchDownloads({ fetch: failing })).toBeNull();
  });

  it("returns null when the payload is not a list of releases", async () => {
    expect(await fetchDownloads({ fetch: respond({ message: "nope" }) })).toBeNull();
  });
});

describe("RELEASES_URL", () => {
  it("points at the repository's releases page", () => {
    expect(RELEASES_URL).toBe("https://github.com/Constelutions/rebasar/releases");
  });
});
