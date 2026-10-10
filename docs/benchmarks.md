# Benchmarks

Large-Repository fixtures and a benchmark runner that exercises the core API. Benchmarks **report; they never gate**: a missed threshold is printed and recorded, and the run still succeeds.

## Fixtures

```sh
pnpm bench:fixtures                # alpha scale
pnpm bench:fixtures --scale smoke  # a few seconds, for checking the harness
```

Three Repositories are generated with real `git` (`git fast-import`, so the history takes minutes rather than hours) and reused on every later run:

| Fixture | Alpha scale |
|---|---|
| `history-*-commits` | About 1.2 million commits on `main` and short-lived topic branches that fork and merge back. Deterministic, so every machine builds the same history. |
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

Defined once, in `crates/rebasar-bench/src/thresholds.rs`:

| Threshold | Limit |
|---|---|
| Cold start to interactive | 1,000 ms |
| Linux-kernel-sized graph usable, scrolling at 60 fps | 2,000 ms |
| Status on a 100k-file working tree | 300 ms |
| Tab switch | 100 ms |
| First file of the 5,000-file / 500k-line changeset | 300 ms |
| Idle memory | 300 MB |

## Adding a scenario

Add a `Scenario` to `scenarios()` in `crates/rebasar-bench/src/runner.rs`: a name and a function over `&Core` and the fixture paths, optionally `.against(&THRESHOLD)`. The placeholder `open-folder-*` scenarios have no threshold; they exist to prove the pipeline. Scenarios are timed as wall-clock durations; a memory scenario will need the runner extended to measure memory.
