const REPOSITORY = "Constelutions/rebasar";
export const REPOSITORY_URL = `https://github.com/${REPOSITORY}`;
export const RELEASES_URL = `${REPOSITORY_URL}/releases`;
const RELEASES_API_URL = `https://api.github.com/repos/${REPOSITORY}/releases?per_page=30`;

export interface ApiAsset {
  name: string;
  browser_download_url: string;
}

export interface ApiRelease {
  tag_name: string;
  draft: boolean;
  prerelease: boolean;
  html_url: string;
  published_at: string | null;
  assets: ApiAsset[];
}

export interface DownloadAsset {
  name: string;
  url: string;
}

export interface ReleaseDownloads {
  version: string;
  releaseUrl: string;
  windows: DownloadAsset | null;
  deb: DownloadAsset | null;
  appImage: DownloadAsset | null;
  checksums: DownloadAsset | null;
}

const publishedAt = (release: ApiRelease) => Date.parse(release.published_at ?? "") || 0;

// The asset names are a contract documented in docs/releasing.md.
export const assetNames = (version: string) => ({
  windows: `Rebasar_${version}_x64-setup.exe`,
  deb: `Rebasar_${version}_amd64.deb`,
  appImage: `Rebasar_${version}_amd64.AppImage`,
});

const findAsset = (release: ApiRelease, name: string): DownloadAsset | null => {
  const asset = release.assets.find((candidate) => candidate.name === name);
  return asset ? { name: asset.name, url: asset.browser_download_url } : null;
};

// `releases/latest` skips pre-releases and every release is one today, so the list is read instead.
export function resolveDownloads(releases: ApiRelease[]): ReleaseDownloads | null {
  const newest = releases
    .filter((release) => !release.draft)
    .sort((a, b) => publishedAt(b) - publishedAt(a))[0];
  if (!newest) return null;

  const version = newest.tag_name.replace(/^v/, "");
  const names = assetNames(version);
  return {
    version,
    releaseUrl: newest.html_url,
    windows: findAsset(newest, names.windows),
    deb: findAsset(newest, names.deb),
    appImage: findAsset(newest, names.appImage),
    checksums: findAsset(newest, "SHA256SUMS"),
  };
}

interface FetchOptions {
  fetch?: typeof fetch;
  token?: string | undefined;
}

// A failed lookup must never fail the build: the page falls back to the releases page instead.
export async function fetchDownloads({
  fetch: fetchImpl = fetch,
  token,
}: FetchOptions = {}): Promise<ReleaseDownloads | null> {
  try {
    const headers: Record<string, string> = { Accept: "application/vnd.github+json" };
    if (token) headers.Authorization = `Bearer ${token}`;

    const response = await fetchImpl(RELEASES_API_URL, { headers });
    if (!response.ok) return null;

    const payload: unknown = await response.json();
    return Array.isArray(payload) ? resolveDownloads(payload as ApiRelease[]) : null;
  } catch {
    return null;
  }
}
