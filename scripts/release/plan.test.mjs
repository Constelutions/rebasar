import assert from "node:assert/strict";
import { test } from "node:test";

import { planRelease, validateAssets, workspaceVersion } from "./plan.mjs";

const hash = (character) => character.repeat(64);

test("a new 0.x.y version on develop is a beta pre-release that goes to winget", () => {
  const plan = planRelease({ version: "0.1.0", branch: "develop", tags: [] });

  assert.deepEqual(plan, {
    release: true,
    tag: "v0.1.0",
    prerelease: true,
    winget: true,
    reason: "v0.1.0 is new",
  });
});

test("a -beta.N version on develop is a pre-release that stays out of winget", () => {
  const plan = planRelease({ version: "1.1.0-beta.2", branch: "develop", tags: ["v1.0.0"] });

  assert.equal(plan.release, true);
  assert.equal(plan.tag, "v1.1.0-beta.2");
  assert.equal(plan.prerelease, true);
  assert.equal(plan.winget, false);
});

test("a new 1.x.y version on main is a stable release that goes to winget", () => {
  const plan = planRelease({ version: "1.0.0", branch: "main", tags: ["v0.9.0"] });

  assert.equal(plan.release, true);
  assert.equal(plan.tag, "v1.0.0");
  assert.equal(plan.prerelease, false);
  assert.equal(plan.winget, true);
});

test("a version whose tag already exists releases nothing", () => {
  const plan = planRelease({ version: "0.1.0", branch: "develop", tags: ["v0.1.0"] });

  assert.equal(plan.release, false);
  assert.match(plan.reason, /already/);
});

test("a branch that is not develop or main releases nothing", () => {
  const plan = planRelease({ version: "0.2.0", branch: "feat/79-beta-release", tags: [] });

  assert.equal(plan.release, false);
  assert.match(plan.reason, /feat\/79-beta-release/);
});

test("a tag that does not match the workspace version is an error", () => {
  assert.throws(
    () => planRelease({ version: "0.2.0", branch: "develop", tags: [], tag: "v0.1.0" }),
    /does not match/,
  );
});

test("a tag that matches the workspace version is accepted", () => {
  const plan = planRelease({ version: "0.2.0", branch: "develop", tags: [], tag: "v0.2.0" });

  assert.equal(plan.release, true);
});

test("main holds 0.x.y until 1.0.0 and releases nothing from it, without failing the run", () => {
  const plan = planRelease({ version: "0.9.0", branch: "main", tags: [] });

  assert.equal(plan.release, false);
  assert.match(plan.reason, /main/);
  assert.match(plan.reason, /1\.0\.0/);
});

test("a pre-release version on main is an error, since main is stable only", () => {
  assert.throws(() => planRelease({ version: "1.1.0-beta.1", branch: "main", tags: [] }), /main/);
});

test("develop releases 0.x.y or suffixed versions, never a bare 1.x.y", () => {
  assert.throws(() => planRelease({ version: "1.0.0", branch: "develop", tags: [] }), /develop/);
});

test("a version that is not semantic is an error", () => {
  for (const version of ["", "1.0", "v1.0.0", "1.0.0.0", "latest"]) {
    assert.throws(
      () => planRelease({ version, branch: "develop", tags: [] }),
      /not a semantic version/,
      version,
    );
  }
});

const completeAssets = (version) => [
  { name: `Rebasar_${version}_x64-setup.exe`, sha256: hash("a") },
  { name: `Rebasar_${version}_amd64.AppImage`, sha256: hash("b") },
  { name: `Rebasar_${version}_amd64.deb`, sha256: hash("c") },
];

const sumsFor = (assets) =>
  assets.map(({ name, sha256 }) => `${sha256}  ${name}`).join("\n") + "\n";

test("a complete set of assets with matching checksums has no problems", () => {
  const assets = completeAssets("0.1.0");

  assert.deepEqual(validateAssets({ version: "0.1.0", assets, checksums: sumsFor(assets) }), []);
});

test("a missing installer is named", () => {
  const assets = completeAssets("0.1.0").filter(({ name }) => !name.endsWith(".AppImage"));

  const problems = validateAssets({ version: "0.1.0", assets, checksums: sumsFor(assets) });

  assert.equal(problems.length, 1);
  assert.match(problems[0], /Rebasar_0\.1\.0_amd64\.AppImage/);
});

test("a misnamed installer is reported as missing and as unexpected", () => {
  const assets = completeAssets("0.1.0");
  assets[1] = { ...assets[1], name: "Rebasar_0.1.0_x86_64.AppImage" };

  const problems = validateAssets({ version: "0.1.0", assets, checksums: sumsFor(assets) });

  assert.ok(problems.some((problem) => /missing.*amd64\.AppImage/.test(problem)));
  assert.ok(problems.some((problem) => /unexpected.*x86_64\.AppImage/.test(problem)));
});

test("assets built for another version are not accepted", () => {
  const assets = completeAssets("0.1.0");

  const problems = validateAssets({ version: "0.2.0", assets, checksums: sumsFor(assets) });

  assert.equal(problems.filter((problem) => /missing/.test(problem)).length, 3);
});

test("SHA256SUMS must list every asset", () => {
  const assets = completeAssets("0.1.0");
  const checksums = sumsFor(assets.slice(0, 2));

  const problems = validateAssets({ version: "0.1.0", assets, checksums });

  assert.equal(problems.length, 1);
  assert.match(problems[0], /amd64\.deb.*not listed/);
});

test("SHA256SUMS must not list files that are not assets", () => {
  const assets = completeAssets("0.1.0");
  const checksums = sumsFor(assets) + `${hash("d")}  stray.txt\n`;

  const problems = validateAssets({ version: "0.1.0", assets, checksums });

  assert.equal(problems.length, 1);
  assert.match(problems[0], /stray\.txt/);
});

test("a checksum that does not match the file is reported", () => {
  const assets = completeAssets("0.1.0");
  const checksums = sumsFor(assets).replace(hash("b"), hash("e"));

  const problems = validateAssets({ version: "0.1.0", assets, checksums });

  assert.equal(problems.length, 1);
  assert.match(problems[0], /amd64\.AppImage.*does not match/);
});

test("a malformed SHA256SUMS line is reported", () => {
  const assets = completeAssets("0.1.0");
  const checksums = sumsFor(assets) + "not a checksum line\n";

  const problems = validateAssets({ version: "0.1.0", assets, checksums });

  assert.ok(problems.some((problem) => /malformed/.test(problem)));
});

test("the binary-mode marker that sha256sum may print is accepted", () => {
  const assets = completeAssets("0.1.0");
  const checksums = assets.map(({ name, sha256 }) => `${sha256} *${name}`).join("\n") + "\n";

  assert.deepEqual(validateAssets({ version: "0.1.0", assets, checksums }), []);
});

const cargoToml = (workspacePackage) => `[workspace]
resolver = "2"
members = ["a"]

[workspace.dependencies]
serde = { version = "1.0.0" }
other = { path = "x", version = "9.9.9" }

[workspace.dependencies.tauri]
version = "2"

[workspace.package]
${workspacePackage}
edition = "2021"
`;

test("the workspace version is the one in [workspace.package], not another version line", () => {
  assert.equal(workspaceVersion(cargoToml('version = "0.1.0"')), "0.1.0");
});

test("a pre-release workspace version is read whole", () => {
  assert.equal(workspaceVersion(cargoToml('version = "1.1.0-beta.2"')), "1.1.0-beta.2");
});

test("a version line before [workspace.package] is ignored", () => {
  const text = `version = "9.9.9"\n\n[workspace.package]\nversion = "0.3.0"\n`;

  assert.equal(workspaceVersion(text), "0.3.0");
});

test("a Cargo.toml without a workspace version is an error", () => {
  assert.throws(() => workspaceVersion(cargoToml("")), /workspace\.package/);
});
