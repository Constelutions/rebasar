// Measures the two alpha thresholds only the running app can answer, and writes them for
// `rebasar-bench run --app-results`:
//
//   cold start  from launching the app until its first click is answered. The WebDriver attaching
//               to the page is part of that time, so the figure is a ceiling, not an optimistic one.
//   idle memory the working sets of the app and every process it started (the WebView2 ones
//               included), with a Repository open and nothing happening.
//
// Usage: node e2e/app-benchmark.mjs --output <file> [--open <repository folder>]
// Set REBASAR_RELEASE=1 to measure the release build, which is what the alpha report uses.
// See docs/benchmarks.md. Windows only.

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { AppSession, buildApp, checkPrerequisites, startDriver } from "./webdriver.mjs";

const IDLE_SETTLE_MS = 8000;
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

function option(name) {
  const at = process.argv.indexOf(name);
  return at >= 0 ? process.argv[at + 1] : undefined;
}

const output = option("--output");
const folder = option("--open");
if (!output) {
  console.error("usage: node e2e/app-benchmark.mjs --output <file> [--open <repository folder>]");
  process.exit(2);
}

/** Megabytes of working set held by the process named `name` and everything below it. */
function memoryOfTree(name) {
  const script = `
    $all = Get-CimInstance Win32_Process
    $root = $all | Where-Object { $_.Name -eq '${name}' } | Select-Object -First 1
    if (-not $root) { throw 'the app is not running' }
    $ids = @($root.ProcessId); $grew = $true
    while ($grew) {
      $before = $ids.Count
      $ids = @($ids) + @($all | Where-Object { $ids -contains $_.ParentProcessId } | ForEach-Object { $_.ProcessId })
      $ids = $ids | Sort-Object -Unique
      $grew = $ids.Count -gt $before
    }
    $total = ($all | Where-Object { $ids -contains $_.ProcessId } | Measure-Object WorkingSetSize -Sum).Sum
    [math]::Round($total / 1MB, 1)`;
  const text = execFileSync("pwsh", ["-NoProfile", "-Command", script], { encoding: "utf8" });
  return Number(text.trim());
}

const scratch = mkdtempSync(join(tmpdir(), "rebasar-bench-app-"));
let driver = null;
let app = null;

try {
  const edgeDriver = checkPrerequisites();
  buildApp();
  driver = await startDriver(edgeDriver, { REBASAR_CONFIG_DIR: join(scratch, "config") });

  const started = performance.now();
  app = await AppSession.launch();
  // Interactive: the sidebar is there and a click on it is answered.
  for (;;) {
    const answered = await app.execute(
      "const b = [...document.querySelectorAll(\"nav[aria-label='Views'] button\")].find((x) => x.textContent === 'History');" +
        "if (!b) return false; b.click(); return b.getAttribute('aria-current') === 'page';",
    );
    if (answered) break;
    if (performance.now() - started > 30000) throw new Error("the app was not interactive within 30 s");
    await sleep(20);
  }
  const coldStartMs = Math.round(performance.now() - started);

  if (folder) {
    await app.openFolder(folder);
    await app.find("css selector", "[role=tab]", 60000);
  }
  await sleep(IDLE_SETTLE_MS);
  const idleMemoryMb = memoryOfTree("rebasar-app.exe");

  const results = { coldStartMs, idleMemoryMb, openedFolder: folder ?? null };
  writeFileSync(output, JSON.stringify(results, null, 2));
  console.log(`cold start ${coldStartMs} ms, idle memory ${idleMemoryMb} MB -> ${output}`);
} catch (error) {
  console.error(`APP BENCHMARK FAILED: ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
} finally {
  await app?.close();
  driver?.kill();
  rmSync(scratch, { recursive: true, force: true });
}
