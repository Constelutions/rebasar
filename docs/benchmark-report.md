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
| Commit graph usable, first page (1.2 M commits) | < 2,000 ms | **38 ms** | within |
| Status on a 100,000-file working tree | < 300 ms | **211 ms** | within |
| Tab switch (20 Repositories, 50 Worktrees open) | < 100 ms | **3 ms** (median 2 ms) | within |
| First file of the 5,000-file / 500k-line changeset | < 300 ms | **105 ms** | within |
| Cold start to interactive | < 1,000 ms | **530 ms** | within |
| Idle memory | < 300 MB | **134 MB** | within |

Every threshold is within its target. The first run of this report missed three ([#77](https://github.com/Constelutions/rebasar/issues/77)); what changed for each is below.

### What the three misses were

- **First file of the changeset, 467 ms in the first run, now 105 ms** ([#52](https://github.com/Constelutions/rebasar/issues/52)). Listing the 5,000 changes takes about 13 ms; the line counts shown beside each file were the other 233 ms, computed one file at a time while listing. The core now lists first and counts across threads. The status of the changeset went from about 250 ms to 102 ms with it. Before the change, remeasuring on this machine gave 241 to 281 ms, not 467 ms, so the original run was slower for a reason that was not reproduced (a loaded machine or a cold file cache are the likely ones); the change is measured against the 250 ms.
- **Cold start, 1,003 ms in the first run, now 530 ms** ([#53](https://github.com/Constelutions/rebasar/issues/53)). Probing the release build separated the parts: `main()` starts about 10 ms after the process; about 410 ms pass inside Tauri creating the window and the WebView2 before the app's own `setup` runs, and `setup` takes about 1 ms; the page then loads and is interactive about 150 ms after it starts navigating. Registry and settings reads, the git check and the session restore all happen after that point, so none of them delays it. The WebDriver's attach time is the rest: the first launch of a driver session took about 450 ms longer than later ones, with the app's own timeline unchanged. The figure is now measured from the app's process start to the `rebasar-interactive` mark the app sets on its first render. The driver-inclusive figure is kept next to it (**915 ms** in this run; 823 to 1,060 ms across runs) as a ceiling. Extra WebView2 launch arguments (`--disable-background-networking` and others) made no difference and were not kept.
- **Idle memory, 416 MB in the first run, now 134 MB** ([#54](https://github.com/Constelutions/rebasar/issues/54)). The 416 MB summed working sets, which count the pages the WebView2 processes share (system libraries, mostly) once per process. Per process, in private working set, with the 100,000-file worktree open: WebView2 browser 29 MB, GPU 52, renderer 26, network 7, storage 3, other 3, and the app itself 10, which is also the core's whole cost for the open Tab. The benchmark now sums private working sets, the figure Task Manager's "Memory" column adds up. The plain working-set sum is kept next to it (**423 MB** in this run) as a ceiling.

### Other figures

- Scrolling the graph: ten further pages of 100 rows took 141 ms in total (about 14 ms a page), under the 16 ms a page that 60 fps needs. The core part is measured; drawing is not.
- 50 Tabs: opening them all took 0.7 s and 24 MB; memory after switching stayed at 34 MB; the file watchers sent no events while idle and used 0 % of a core.
- Refreshing a Tab after switching to it: median 8.6 ms, slowest 11 ms.
- The core figures are warm-cache runs on the same machine as the first run, so the unchanged scenarios differ from it by the state of the file cache (the first page of the graph read 286 ms then and 38 ms now).

## What the figures do not cover

- The webview's own work: React painting a Tab, the diff rows, the graph canvas.
- The effect of a cold file cache on the cold start (the first launch after a build is the slowest), and Windows Defender scanning a freshly built executable.
- Memory with 20 Repositories open in the app rather than in the core harness.

## Reproducing

```sh
pnpm bench:fixtures                         # once, about 7 minutes
$env:REBASAR_RELEASE = 1                    # measure the release build of the app
pnpm bench:app --output app.json --open <fixtures>\worktree-100000-files
pnpm bench --app-results app.json           # prints the table above and records JSON
```

`pnpm bench:app` needs the same setup as the [smoke run](smoke-run.md) (`tauri-driver`, `msedgedriver`).
