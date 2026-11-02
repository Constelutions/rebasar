# Benchmarks

Large-Repository fixtures and a benchmark runner that exercises the core API. Benchmarks **report; they never gate**: a missed threshold is printed and recorded, and the run still succeeds.

## Fixtures

```sh
pnpm bench:fixtures                # alpha scale
pnpm bench:fixtures --scale smoke  # a few seconds, for checking the harness
```

Four fixtures are generated with real `git` (`git fast-import`, so the history takes minutes rather than hours; the alpha scale took about 6.5 minutes on the development machine) and reused on every later run:

| Fixture | Alpha scale |
|---|---|
| `history-*-commits` | About 1.2 million commits on `main` and topic branches (up to 20 open at once) that fork and merge back, roughly 8% of them merges. Deterministic, so every machine builds the same history. |
| `worktree-*-files` | A clean checkout of 100,000 files. |
| `changeset-*-files-*-lines` | 5,000 committed files with 500,000 changed lines (added plus removed, spread evenly) left uncommitted in the working tree. |
| `tabs-*-repositories-*-worktrees-*-files` | 20 small Repositories (200 files each) with 50 Worktrees between them: every Repository's main Worktree plus linked ones. Stands in for a crowded Tab strip. |

Fixtures live outside the source tree and are never committed:

1. `REBASAR_FIXTURE_DIR`, when set;
2. otherwise `%LOCALAPPDATA%\rebasar\fixtures`, or `$XDG_CACHE_HOME/rebasar/fixtures`, or `~/.cache/rebasar/fixtures`.

A fixture is built in a `*.partial` folder and renamed once complete, so an interrupted run is discarded and rebuilt rather than trusted. Delete a fixture folder to force a rebuild.

## Running

```sh
pnpm bench                         # alpha scale
pnpm bench --scale smoke           # quick check
pnpm bench --output results.json   # choose where the JSON is recorded
```

The runner builds any missing fixture, times each scenario through the core API, prints the timings next to the alpha thresholds, and records the same data as JSON (by default in `<fixture folder>/results/<unix time>.json`). Every threshold is listed; ones without a scenario yet read "not measured yet".

## Thresholds

Defined once, in `crates/rebasar-bench/src/thresholds.rs`: cold start, commit graph, status on 100k files, Tab switch, first changeset file and idle memory, with the limits from the alpha definition. The report lists every one, with the scenarios that measure it.

## Commit graph

`history-first-page` asks the core for the first 100 rows of the 1.2-million-commit `history-*` fixture on a cold core (laying out the refs' tips, reading the commits and assigning lanes) and is checked against the 2 s graph threshold. `history-scroll-ten-pages` then requests the next ten pages of 100 rows, one after the other, as scrolling does; at 60 fps each page should take well under 16 ms. On the development machine (release build, alpha scale) the first page took about 93 ms and the ten scrolled pages about 132 ms in total. Rendering is not measured here: the UI only draws the rows around the viewport.

## Adding a scenario

Add a `Scenario` to `scenarios()` in `crates/rebasar-bench/src/runner.rs`: a name and a function over `&Core` and the fixture paths, optionally `.against(&THRESHOLD)`. Call `.after_warm_up()` for an operation the app repeats on a warm file cache: the action then runs once untimed before the timed run. The `status-worktree` scenario does this and is measured against the 100k-file status threshold; `status-changeset` times the same read on the changeset fixture without a threshold. The `first-changeset-file` scenario lists the changeset's changes and diffs the first one, the core part of showing the first file; rendering it is the UI's share and is not measured. The placeholder `open-folder-*` scenarios have no threshold; they exist to prove the pipeline. Scenarios are timed as wall-clock durations.

## Tabs at scale

The `tabs-at-scale` scenario opens every Worktree of the `tabs` fixture as a Tab (open, activate, read its status for the live dot), stays idle for two seconds, then switches between the Tabs twice over, keeping an 8 MB cache for the active one each time. It records, as measurements printed under the scenario and in the JSON: time, memory and CPU of opening everything; CPU and file-watcher events while idle; memory after switching (it must not grow with the number of Tabs, because only the active Tab keeps its caches); and the median and slowest `activate_tab` call, which is what the **Tab switch** threshold is compared with. The status read that refreshes a Tab after a switch is reported separately.

What is measured there is the core's share of the app: the webview's memory and the time React takes to paint a Tab are not included.

## Cold start and idle memory

These two only the running app can answer, so `pnpm bench:app` (`e2e/app-benchmark.mjs`) launches the app through the Tauri WebDriver, with the same setup as the [smoke run](smoke-run.md). **Cold start** is the time from the app's process starting until it first became interactive: the app sets a `rebasar-interactive` performance mark when it first renders, and the benchmark subtracts the process's start time from it. The time from launching until the driver's first click on the sidebar is answered is recorded next to it as `cold-start-with-driver-ms`; it includes the WebDriver attaching to the page (about 450 ms more on the first launch of a driver session), so it is a ceiling and not what a user waits. **Idle memory** is the sum of the private working sets of the app and every process it started (the WebView2 ones included), after a Repository is open and eight seconds of idleness: the memory those processes hold that nothing else shares, which is what Task Manager's "Memory" column adds up. The plain sum of their working sets is recorded next to it as `app-memory-working-set`; it counts the pages the WebView2 processes share (system libraries, mostly) once per process, so it is a ceiling and about three times the private figure. Set `REBASAR_RELEASE=1` to measure the release build, which is what the alpha report uses.

```sh
pnpm bench:app --output app.json --open <folder of a Repository>
pnpm bench --app-results app.json
```

`--app-results` adds the two measured scenarios (`app-cold-start`, `app-idle-memory`) to the report, so every threshold is measured. The alpha results are in [benchmark-report.md](benchmark-report.md).
