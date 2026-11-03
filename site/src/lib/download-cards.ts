import type { DesktopOs } from "./os";
import { RELEASES_URL, type DownloadAsset, type ReleaseDownloads } from "./releases";

export interface DownloadCard {
  id: "windows" | "deb" | "appimage" | "macos";
  name: string;
  file: string | null;
  href: string | null;
  note: string;
  // The platform whose visitors this card is recommended to.
  os: DesktopOs | null;
}

const linkFor = (asset: DownloadAsset | null | undefined, downloads: ReleaseDownloads | null) =>
  asset?.url ?? downloads?.releaseUrl ?? RELEASES_URL;

export function buildCards(downloads: ReleaseDownloads | null): DownloadCard[] {
  const version = downloads?.version ?? "<version>";
  const windowsFile = downloads?.windows?.name ?? `Rebasar_${version}_x64-setup.exe`;
  const debFile = downloads?.deb?.name ?? `Rebasar_${version}_amd64.deb`;
  const appImageFile = downloads?.appImage?.name ?? `Rebasar_${version}_amd64.AppImage`;

  return [
    {
      id: "windows",
      name: "Windows 10 and 11 (x64)",
      file: windowsFile,
      href: linkFor(downloads?.windows, downloads),
      note: "Per-user install, no administrator rights. Also installs the `rebasar` command.",
      os: "Windows",
    },
    {
      id: "deb",
      name: "Debian and Ubuntu (x64)",
      file: debFile,
      href: linkFor(downloads?.deb, downloads),
      note: `\`sudo apt install ./${debFile}\`, also installs \`git\`. Also installs the \`rebasar\` command.`,
      os: "Linux",
    },
    {
      id: "appimage",
      name: "Any Linux (x64)",
      file: appImageFile,
      href: linkFor(downloads?.appImage, downloads),
      note: "`chmod +x`, then run it.",
      os: null,
    },
    { id: "macos", name: "macOS", file: null, href: null, note: "Later.", os: null },
  ];
}

export function heroLinks(downloads: ReleaseDownloads | null): Record<DesktopOs, string> {
  return {
    Windows: linkFor(downloads?.windows, downloads),
    Linux: linkFor(downloads?.deb, downloads),
  };
}

// The notes mark code with backticks; splitting on them alternates text and code.
export const splitCode = (note: string) =>
  note.split("`").map((text, index) => ({ text, code: index % 2 === 1 }));
