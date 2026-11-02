// Measures the two alpha thresholds only the running app can answer, and writes them for
// `rebasar-bench run --app-results`:
//
//   cold start  from the app's process starting until it first became interactive (the mark the
//               app sets when it first renders). The WebDriver's attach time is not part of it; the
//               time from launching until the driver's first click is answered is recorded next to
//               it as `coldStartWithDriverMs`, a ceiling.
//   idle memory the private working sets of the app and every process it started (the WebView2
//               ones included), with a Repository open and nothing happening. The plain sum of
//               their working sets, which counts shared pages once per process, is recorded
//               next to it as `idleWorkingSetMb`, a ceiling.
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

/**
 * Megabytes held by the process named `name` and everything below it: the sum of their private
 * working sets (what no other process shares, and what Task Manager's "Memory" column adds up)
 * and, as a ceiling, the sum of their plain working sets, which counts the pages the WebView2
 * processes share once per process.
 */
function memoryOfTree(name) {
  const script = String.raw`
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
    $private = 0
    (Get-Counter '\Process V2(*)\Working Set - Private').CounterSamples | ForEach-Object {
      if ($_.InstanceName -match ':(\d+)$' -and $ids -contains [int]$matches[1]) { $private += $_.CookedValue }
    }
    if ($private -le 0) { throw 'the private working set counters returned nothing for the app' }
    $total = ($all | Where-Object { $ids -contains $_.ProcessId } | Measure-Object WorkingSetSize -Sum).Sum
    '{0} {1}' -f [math]::Round($private / 1MB, 1), [math]::Round($total / 1MB, 1)`;
  const text = execFileSync("pwsh", ["-NoProfile", "-Command", script], { encoding: "utf8" });
  const [privateMb, workingSetMb] = text.trim().split(" ").map(Number);
  return { privateMb, workingSetMb };
}

/** When the process named `name` started, in milliseconds since the Unix epoch. */
function startOfProcess(name) {
  const script = `([DateTimeOffset](Get-Process '${name.replace(/\.exe$/, "")}' | Select-Object -First 1).StartTime).ToUnixTimeMilliseconds()`;
  return Number(execFileSync("pwsh", ["-NoProfile", "-Command", script], { encoding: "utf8" }).trim());
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
  const coldStartWithDriverMs = Math.round(performance.now() - started);
  const interactiveAt = await app.execute(
    "const [mark] = performance.getEntriesByName('rebasar-interactive', 'mark');" +
      "return mark ? performance.timeOrigin + mark.startTime : null;",
  );
  if (interactiveAt === null) throw new Error("the app did not record when it became interactive");
  const coldStartMs = Math.round(interactiveAt - startOfProcess("rebasar-app.exe"));

  if (folder) {
    await app.openFolder(folder);
    await app.find("css selector", "[role=tab]", 60000);
  }
  await sleep(IDLE_SETTLE_MS);
  const { privateMb: idleMemoryMb, workingSetMb: idleWorkingSetMb } = memoryOfTree("rebasar-app.exe");

  const results = { coldStartMs, coldStartWithDriverMs, idleMemoryMb, idleWorkingSetMb, openedFolder: folder ?? null };
  writeFileSync(output, JSON.stringify(results, null, 2));
  console.log(
    `cold start ${coldStartMs} ms (${coldStartWithDriverMs} ms with the driver), idle memory ${idleMemoryMb} MB (${idleWorkingSetMb} MB of working set) -> ${output}`,
  );
} catch (error) {
  console.error(`APP BENCHMARK FAILED: ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
} finally {
  await app?.close();
  driver?.kill();
  rmSync(scratch, { recursive: true, force: true });
}
