// What the smoke run and the app benchmark share: prerequisites, building the app, starting
// `tauri-driver` and talking to it over the W3C WebDriver protocol. No dependencies.

import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const binary = process.platform === "win32" ? "rebasar-app.exe" : "rebasar-app";

/** The app the run drives: the debug build, or the release one when `REBASAR_RELEASE` is set. */
export const release = Boolean(process.env.REBASAR_RELEASE);
export const exe = join(root, "target", release ? "release" : "debug", binary);

const driverPort = 4444;
const elementKey = "element-6066-11e4-a52e-4f735466cecf";

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

function which(program) {
  const finder = process.platform === "win32" ? "where" : "which";
  const found = spawnSync(finder, [program], { encoding: "utf8" });
  return found.status === 0 ? found.stdout.split(/\r?\n/)[0] : null;
}

/** Throws a readable list of what to install; otherwise returns the path of `msedgedriver`. */
export function checkPrerequisites() {
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

export function buildApp() {
  const run = (command, args) =>
    execFileSync(command, args, { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
  run("pnpm", ["--filter", "@rebasar/ui", "build"]);
  run("pnpm", ["tauri", "build", ...(release ? [] : ["--debug"]), "--no-bundle"]);
  if (!existsSync(exe)) throw new Error(`The build did not produce ${exe}`);
}

/** Starts `tauri-driver` with `env` added to what the app it launches will inherit. */
export async function startDriver(edgeDriver, env) {
  const driver = spawn("tauri-driver", ["--native-driver", edgeDriver], {
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      if ((await fetch(`http://127.0.0.1:${driverPort}/status`)).ok) return driver;
    } catch {
      // Not listening yet.
    }
    await sleep(200);
  }
  driver.kill();
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

export class AppSession {
  constructor(id) {
    this.id = id;
  }

  /** Launches the app. Resolves once the driver has attached to its first page. */
  static async launch() {
    const created = await request("POST", "/session", {
      capabilities: { alwaysMatch: { browserName: "wry", "tauri:options": { application: exe } } },
    });
    return new AppSession(created.sessionId);
  }

  async find(using, value, timeoutMs = 15000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      try {
        const found = await request("POST", `/session/${this.id}/element`, { using, value });
        return found[elementKey];
      } catch (error) {
        if (Date.now() > deadline) throw new Error(`Could not find ${using} ${value}: ${error.message}`);
        await sleep(250);
      }
    }
  }

  async click(using, value) {
    await request("POST", `/session/${this.id}/element/${await this.find(using, value)}/click`, {});
  }

  async type(using, value, text) {
    await request("POST", `/session/${this.id}/element/${await this.find(using, value)}/value`, { text });
  }

  /** Runs `script` in the page; it may use `arguments` and `return` a value. */
  execute(script, args = []) {
    return request("POST", `/session/${this.id}/execute/sync`, { script, args });
  }

  /** Runs a script that calls its last argument, a callback, when it is finished. */
  executeAsync(script, args = []) {
    return request("POST", `/session/${this.id}/execute/async`, { script, args });
  }

  /** Opens a Repository through the app's own command: the native folder dialog cannot be driven. */
  async openFolder(path) {
    await this.executeAsync(
      "const [path, done] = [arguments[0], arguments[arguments.length - 1]];" +
        "window.__TAURI_INTERNALS__.invoke('open_folder', { path }).then(() => done(null), (e) => done(String(e)));",
      [path],
    );
  }

  screenshot() {
    return request("GET", `/session/${this.id}/screenshot`);
  }

  async close() {
    await request("DELETE", `/session/${this.id}`).catch(() => {});
  }
}
