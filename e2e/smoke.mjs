// A single end-to-end sanity check: the real app, driven through the Tauri WebDriver, opens a
// temporary Repository, stages a change, commits it and finds the commit in History.
// It is not a substitute for the core API and UI suites. See docs/smoke-run.md.

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { AppSession, buildApp, checkPrerequisites, startDriver } from "./webdriver.mjs";

const commitSubject = "feat: smoke run commit";

const scratch = mkdtempSync(join(tmpdir(), "rebasar-smoke-"));
const repository = join(scratch, "sample");
const configDir = join(scratch, "config");
let driver = null;
let app = null;
let step = "start";

function git(args) {
  execFileSync("git", args, { cwd: repository, stdio: "pipe" });
}

function makeRepository() {
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

async function run() {
  step = "prerequisites";
  const edgeDriver = checkPrerequisites();
  step = "build the app";
  buildApp();
  step = "create the temporary Repository";
  makeRepository();

  step = "start tauri-driver";
  driver = await startDriver(edgeDriver, { REBASAR_CONFIG_DIR: configDir });

  step = "launch the app";
  app = await AppSession.launch();

  step = "open the temporary Repository";
  await app.openFolder(repository);
  await app.find("css selector", "[role=tab]");

  step = "stage the change";
  await app.click("xpath", "//button[normalize-space()='Changes']");
  await app.click("css selector", "button[aria-label='Stage notes.txt']");
  await app.find("css selector", "button[aria-label='Unstage notes.txt']");

  step = "commit";
  await app.type("css selector", "form[aria-label='Commit'] input[type=text]", commitSubject);
  await app.click("xpath", "//form[@aria-label='Commit']//button[@type='submit']");
  await app.find("xpath", "//*[@role='status' and contains(., 'succeeded')]");

  step = "find the commit in History";
  await app.click("xpath", "//button[normalize-space()='History']");
  await app.find("xpath", `//*[@aria-label='Commit history']//*[contains(., '${commitSubject}')]`);

  console.log("\nSMOKE RUN PASSED: opened a Repository, staged a change, committed it and found it in History.");
}

try {
  await run();
} catch (error) {
  console.error(`\nSMOKE RUN FAILED at step "${step}":\n${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
  if (app) {
    try {
      const file = join(scratch, "failure.png");
      writeFileSync(file, Buffer.from(await app.screenshot(), "base64"));
      console.error(`A screenshot of the app was saved to ${file}`);
    } catch {
      // The app may be gone already.
    }
  }
} finally {
  await app?.close();
  driver?.kill();
  // Kept after a failure, so the screenshot and the Repository can be looked at.
  if (process.exitCode !== 1) rmSync(scratch, { recursive: true, force: true });
  else console.error(`Scratch folder kept: ${scratch}`);
}
