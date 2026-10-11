# Benchmarks

Large-Repository fixtures and a benchmark runner that exercises the core API. Benchmarks **report; they never gate**: a missed threshold is printed and recorded, and the run still succeeds.

## Fixtures

```sh
pnpm bench:fixtures                # alpha scale
pnpm bench:fixtures --scale smoke  # a few seconds, for checking the harness
```

Three Repositories are generated with real `git` (`git fast-import`, so the history takes minutes rather than hours; the alpha scale took about 6.5 minutes on the development machine) and reused on every later run:

| Fixture | Alpha scale |
|---|---|
| `history-*-commits` | About 1.2 million commits on `main` and topic branches (up to 20 open at once) that fork and merge back, roughly 8% of them merges. Deterministic, so every machine builds the same history. |
| `worktree-*-files` | A clean checkout of 100,000 files. |
| `changeset-*-files-*-lines` | 5,000 committed files with 500,000 changed lines (added plus removed, spread evenly) left uncommitted in the working tree. |

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

## Adding a scenario

Add a `Scenario` to `scenarios()` in `crates/rebasar-bench/src/runner.rs`: a name and a function over `&Core` and the fixture paths, optionally `.against(&THRESHOLD)`. Call `.after_warm_up()` for an operation the app repeats on a warm file cache: the action then runs once untimed before the timed run. The `status-worktree` scenario does this and is measured against the 100k-file status threshold; `status-changeset` times the same read on the changeset fixture without a threshold. The placeholder `open-folder-*` scenarios have no threshold; they exist to prove the pipeline. Scenarios are timed as wall-clock durations; a memory scenario will need the runner extended to measure memory.
