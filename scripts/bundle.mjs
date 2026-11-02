// Builds the installers: the `rebasar` CLI first, then the desktop app with the CLI bundled
// beside it. See docs/releasing.md.
//
// The CLI is a Tauri external binary, and Tauri checks that it exists whenever the app crate is
// compiled, which would break `cargo test` and `pnpm dev`. So it is declared only in the overlay
// config this script passes to `tauri build`.

import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const onWindows = process.platform === "win32";
const executableSuffix = onWindows ? ".exe" : "";
const targetDirectory = process.env.CARGO_TARGET_DIR ?? "target";

const hostTriple = /^host: (\S+)$/m.exec(execFileSync("rustc", ["-vV"], { encoding: "utf8" }))?.[1];
if (!hostTriple) throw new Error("could not read the host target triple from `rustc -vV`");

run("cargo", ["build", "--release", "-p", "rebasar-cli"]);

mkdirSync(join("src-tauri", "binaries"), { recursive: true });
copyFileSync(
  join(targetDirectory, "release", `rebasar${executableSuffix}`),
  join("src-tauri", "binaries", `rebasar-${hostTriple}${executableSuffix}`),
);

run("pnpm", ["tauri", "build", "--config", join("src-tauri", "tauri.bundle.conf.json"), ...process.argv.slice(2)]);

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit", shell: onWindows });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
