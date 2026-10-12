// A single end-to-end sanity check: the real app, driven through the Tauri WebDriver, opens a
// temporary Repository, stages a change, commits it and finds the commit in History.
// It is not a substitute for the core API and UI suites. See docs/smoke-run.md.

import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const exe = join(root, "target", "debug", process.platform === "win32" ? "rebasar-app.exe" : "rebasar-app");
const driverPort = 4444;
const commitSubject = "feat: smoke run commit";

const scratch = mkdtempSync(join(tmpdir(), "rebasar-smoke-"));
const repository = join(scratch, "sample");
const configDir = join(scratch, "config");
let driver = null;
let session = null;
let step = "start";

function fail(message) {
  console.error(`\nSMOKE RUN FAILED at step "${step}":\n${message}`);
  process.exitCode = 1;
}

function which(program) {
  const finder = process.platform === "win32" ? "where" : "which";
  const found = spawnSync(finder, [program], { encoding: "utf8" });
  return found.status === 0 ? found.stdout.split(/\r?\n/)[0] : null;
}

function checkPrerequisites() {
  step = "prerequisites";
  const missing = [];
  if (!which("tauri-driver")) missing.push("tauri-driver: run `cargo install tauri-driver --locked`");
  const edgeDriver = process.env.EDGE_DRIVER ?? which("msedgedriver");
  if (!edgeDriver) {
    missing.push(
      "msedgedriver: download the version matching your WebView2 runtime from " +
        "https://developer.microsoft.com/microsoft-edge/tools/webdriver and put it on PATH, " +
        "or set EDGE_DRIVER to its path",
    );
  }
  if (missing.length > 0) throw new Error(`Missing:\n- ${missing.join("\n- ")}`);
  return edgeDriver;
}

function build() {
  step = "build the app";
  const run = (command, args) =>
    execFileSync(command, args, { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
  run("pnpm", ["--filter", "@rebasar/ui", "build"]);
  run("pnpm", ["tauri", "build", "--debug", "--no-bundle"]);
  if (!existsSync(exe)) throw new Error(`The build did not produce ${exe}`);
}

function git(args, options = {}) {
  execFileSync("git", args, { cwd: repository, stdio: "pipe", ...options });
}

function makeRepository() {
  step = "create the temporary Repository";
  mkdirSync(repository, { recursive: true });
  git(["init", "--initial-branch=main"]);
  git(["config", "user.name", "Smoke Test"]);
  git(["config", "user.email", "smoke@example.com"]);
  git(["config", "commit.gpgsign", "false"]);
  writeFileSync(join(repository, "notes.txt"), "one\n");
  git(["add", "notes.txt"]);
  git(["commit", "-m", "Initial commit"]);
  writeFileSync(join(repository, "notes.txt"), "one\ntwo\n");
}

async function waitForDriver() {
  step = "start tauri-driver";
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${driverPort}/status`);
      if (response.ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 200));
  }
  throw new Error("tauri-driver did not start listening on port 4444");
}

async function request(method, path, body) {
  const response = await fetch(`http://127.0.0.1:${driverPort}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.value?.message ?? JSON.stringify(payload));
  return payload.value;
}

const elementKey = "element-6066-11e4-a52e-4f735466cecf";

async function find(using, value, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const found = await request("POST", `/session/${session}/element`, { using, value });
      return found[elementKey];
    } catch (error) {
      if (Date.now() > deadline) throw new Error(`Could not find ${using} ${value}: ${error.message}`);
      await new Promise((resolveWait) => setTimeout(resolveWait, 250));
    }
  }
}

const click = async (using, value) => request("POST", `/session/${session}/element/${await find(using, value)}/click`, {});

async function type(using, value, text) {
  const id = await find(using, value);
  await request("POST", `/session/${session}/element/${id}/value`, { text });
}

async function run() {
  const edgeDriver = checkPrerequisites();
  build();
  makeRepository();

  step = "start tauri-driver";
  driver = spawn("tauri-driver", ["--native-driver", edgeDriver], {
    stdio: "inherit",
    env: { ...process.env, REBASAR_CONFIG_DIR: configDir },
  });
  await waitForDriver();

  step = "launch the app";
  const created = await request("POST", "/session", {
    capabilities: { alwaysMatch: { browserName: "wry", "tauri:options": { application: exe } } },
  });
  session = created.sessionId;

  step = "open the temporary Repository";
  await request("POST", `/session/${session}/execute/async`, {
    script: "const [path, done] = [arguments[0], arguments[arguments.length - 1]];" +
      "window.__TAURI_INTERNALS__.invoke('open_folder', { path }).then(() => done(null), (e) => done(String(e)));",
    args: [repository],
  });
  await find("css selector", "[role=tab]");

  step = "stage the change";
  await click("xpath", "//button[normalize-space()='Changes']");
  await click("css selector", "button[aria-label='Stage notes.txt']");
  await find("css selector", "button[aria-label='Unstage notes.txt']");

  step = "commit";
  await type("css selector", "form[aria-label='Commit'] input[type=text]", commitSubject);
  await click("xpath", "//form[@aria-label='Commit']//button[@type='submit']");
  await find("xpath", "//*[@role='status' and contains(., 'succeeded')]");

  step = "find the commit in History";
  await click("xpath", "//button[normalize-space()='History']");
  await find("xpath", `//*[@aria-label='Commit history']//*[contains(., '${commitSubject}')]`);

  console.log("\nSMOKE RUN PASSED: opened a Repository, staged a change, committed it and found it in History.");
}

async function saveScreenshot() {
  try {
    const png = await request("GET", `/session/${session}/screenshot`);
    const file = join(scratch, "failure.png");
    writeFileSync(file, Buffer.from(png, "base64"));
    console.error(`A screenshot of the app was saved to ${file}`);
    return true;
  } catch {
    return false;
  }
}

try {
  await run();
} catch (error) {
  if (session) await saveScreenshot();
  fail(error instanceof Error ? error.message : String(error));
} finally {
  if (session) await request("DELETE", `/session/${session}`).catch(() => {});
  driver?.kill();
  // Kept after a failure, so the screenshot and the Repository can be looked at.
  if (process.exitCode !== 1) rmSync(scratch, { recursive: true, force: true });
  else console.error(`Scratch folder kept: ${scratch}`);
}
