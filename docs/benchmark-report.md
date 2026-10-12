# Alpha benchmark report

Every alpha performance threshold, measured on the generated benchmark Repository. Benchmarks **report; they do not gate** the alpha.

|  |  |
|---|---|
| Machine | Intel Core i9-12900K, 48 GB RAM, Windows 11 Enterprise |
| Scale | alpha: 1.2 million commits, 100,000-file worktree, 5,000-file / 500,000-line changeset, 20 Repositories with 50 Worktrees |
| Core scenarios | `rebasar-bench` release build, `pnpm bench` (`--app-results` for the two app figures) |
| App scenarios | release build of the app (`REBASAR_RELEASE=1 pnpm bench:app`), driven through the Tauri WebDriver with the 100,000-file worktree open |
| Raw data | [`benchmark-results/alpha.json`](benchmark-results/alpha.json) |

## Results

| Threshold | Target | Measured | |
|---|---|---|---|
| Commit graph usable, first page (1.2 M commits) | < 2,000 ms | **286 ms** | within |
| Status on a 100,000-file working tree | < 300 ms | **235 ms** | within |
| Tab switch (20 Repositories, 50 Worktrees open) | < 100 ms | **6 ms** (median 3 ms) | within |
| First file of the 5,000-file / 500k-line changeset | < 300 ms | **467 ms** | **missed** |
| Cold start to interactive | < 1,000 ms | **1,003 ms** | **missed** (by 3 ms) |
| Idle memory | < 300 MB | **416 MB** | **missed** |

### Misses

- **First file of the changeset, 467 ms against 300 ms.** This is the core's share only (list the 5,000 changes, diff the first file); rendering is not included, so the real figure is higher. Most of it is the status read of the 5,000-file changeset (299 ms in `status-changeset`).
- **Cold start, 1,003 ms against 1,000 ms.** Measured from launching the app until a click on the sidebar is answered. The WebDriver attaching to the page is part of that time, so the app's own figure is somewhat lower, but it was not isolated; the first launch after a build is the slowest.
- **Idle memory, 416 MB against 300 MB.** The sum of the working sets of the app and every process it started, with the 100,000-file worktree open and eight seconds of idleness. Working set counts memory the WebView2 processes share, so it overstates what the app alone costs; a private-memory figure was not taken. What each process holds was not broken down.

Follow-up issues: first changeset file [#52](https://github.com/Constelutions/rebasar/issues/52), cold start [#53](https://github.com/Constelutions/rebasar/issues/53), idle memory [#54](https://github.com/Constelutions/rebasar/issues/54).

### Other figures

- Scrolling the graph: ten further pages of 100 rows took 380 ms in total (about 38 ms a page), above the 16 ms a page that 60 fps needs. The core part is measured; drawing is not.
- Status on the changeset fixture: 299 ms.
- 50 Tabs: opening them all took 3.2 s and 21 MB; memory after switching stayed at 29 MB; the file watchers sent no events while idle and used 0.8 % of a core.
- Refreshing a Tab after switching to it: median 9.6 ms, slowest 22 ms.

## What the figures do not cover

- The webview's own work: React painting a Tab, the diff rows, the graph canvas.
- Cold start without the WebDriver's attach time, and the effect of a cold file cache.
- Private (non-shared) memory, and memory with 20 Repositories open in the app rather than in the core harness.

## Reproducing

```sh
pnpm bench:fixtures                         # once, about 7 minutes
$env:REBASAR_RELEASE = 1                    # measure the release build of the app
pnpm bench:app --output app.json --open <fixtures>\worktree-100000-files
pnpm bench --app-results app.json           # prints the table above and records JSON
```

`pnpm bench:app` needs the same setup as the [smoke run](smoke-run.md) (`tauri-driver`, `msedgedriver`).
