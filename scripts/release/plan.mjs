// Decides whether a push releases, and checks that the built assets match the contract the
// marketing site and winget depend on. The rules live here, as pure functions, so they are tested
// without running a workflow. See docs/releasing.md and ADR-0004.

import { createHash } from "node:crypto";
import { appendFileSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z][0-9A-Za-z.-]*))?$/;
const CHECKSUM_LINE = /^([0-9a-fA-F]{64}) [ *](.+)$/;

function parseVersion(version) {
  const match = SEMVER.exec(version);
  if (!match) throw new Error(`"${version}" is not a semantic version`);
  return { major: Number(match[1]), prerelease: match[4] ?? null };
}

/**
 * @param {{ version: string, branch: string, tags: string[], tag?: string }} input
 *   `tag` is the tag a run was started for, when it was started for one.
 */
export function planRelease({ version, branch, tags, tag }) {
  const { major, prerelease } = parseVersion(version);
  const expectedTag = `v${version}`;

  if (tag !== undefined && tag !== expectedTag) {
    throw new Error(
      `the tag ${tag} does not match the workspace version ${version} (expected ${expectedTag})`,
    );
  }

  const nothing = (reason) => ({
    release: false,
    tag: expectedTag,
    prerelease: false,
    winget: false,
    reason,
  });

  if (branch !== "develop" && branch !== "main") {
    return nothing(`${branch} does not publish releases`);
  }
  if (branch === "main" && (major < 1 || prerelease)) {
    throw new Error(`main releases stable 1.x.y versions, and ${version} is not one`);
  }
  if (branch === "develop" && major >= 1 && !prerelease) {
    throw new Error(
      `develop releases 0.x.y or pre-release versions, and ${version} is a stable version that belongs on main`,
    );
  }
  if (tags.includes(expectedTag)) return nothing(`${expectedTag} already exists`);

  return {
    release: true,
    tag: expectedTag,
    prerelease: branch === "develop",
    // winget orders versions with a pre-release suffix poorly, so it only gets the others.
    winget: prerelease === null,
    reason: `${expectedTag} is new`,
  };
}

/**
 * The names are the contract: the site renders download buttons from them and winget points at
 * them. Returns every way `assets` and `checksums` (the text of SHA256SUMS) break it.
 *
 * @param {{ version: string, assets: { name: string, sha256: string }[], checksums: string }} input
 */
export function validateAssets({ version, assets, checksums }) {
  const expected = [
    `Rebasar_${version}_x64-setup.exe`,
    `Rebasar_${version}_amd64.AppImage`,
    `Rebasar_${version}_amd64.deb`,
  ];
  const problems = [];
  const names = assets.map(({ name }) => name);

  for (const name of expected) {
    if (!names.includes(name)) problems.push(`missing ${name}`);
  }
  for (const name of names) {
    if (name.startsWith("Rebasar_") && !expected.includes(name)) {
      problems.push(`unexpected asset ${name}`);
    }
  }

  const listed = new Map();
  for (const line of checksums.split(/\r?\n/).filter((text) => text.trim() !== "")) {
    const match = CHECKSUM_LINE.exec(line);
    if (match) listed.set(match[2], match[1].toLowerCase());
    else problems.push(`malformed SHA256SUMS line: ${line}`);
  }

  for (const { name, sha256 } of assets) {
    if (!listed.has(name)) problems.push(`${name} is not listed in SHA256SUMS`);
    else if (listed.get(name) !== sha256) {
      problems.push(`the checksum of ${name} does not match the file`);
    }
  }
  for (const name of listed.keys()) {
    if (!names.includes(name)) problems.push(`SHA256SUMS lists ${name}, which is not an asset`);
  }

  return problems;
}

function option(args, name) {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? undefined : args[at + 1];
}

function required(args, name) {
  const value = option(args, name);
  if (value === undefined) throw new Error(`missing --${name}`);
  return value;
}

function main(args) {
  const [command] = args;

  if (command === "plan") {
    const plan = planRelease({
      version: required(args, "version"),
      branch: required(args, "branch"),
      tags: (option(args, "tags") ?? "").split(/\s+/).filter(Boolean),
      tag: option(args, "tag"),
    });
    const lines = Object.entries(plan).map(([key, value]) => `${key}=${value}`);
    console.log(lines.join("\n"));
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join("\n")}\n`);
    return 0;
  }

  if (command === "check-assets") {
    const directory = required(args, "dir");
    const assets = readdirSync(directory)
      .filter((name) => name !== "SHA256SUMS")
      .map((name) => ({
        name,
        sha256: createHash("sha256").update(readFileSync(join(directory, name))).digest("hex"),
      }));
    const checksums = readFileSync(join(directory, "SHA256SUMS"), "utf8");
    const problems = validateAssets({ version: required(args, "version"), assets, checksums });
    for (const problem of problems) console.error(`error: ${problem}`);
    return problems.length === 0 ? 0 : 1;
  }

  console.error("usage: plan.mjs plan --version V --branch B [--tags 'v0.1.0 v0.2.0'] [--tag T]");
  console.error("       plan.mjs check-assets --version V --dir DIR");
  return 2;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(`error: ${error.message}`);
    process.exitCode = 1;
  }
}
