# Windows smoke run

One automated end-to-end run proves the app works as a whole on Windows: it launches the real app through the Tauri WebDriver, opens a temporary Repository, stages a change, commits it and finds the commit in History.

It is a sanity check, **not** a substitute for the core API suites (`pnpm test:core`) or the UI suites (`pnpm test:ui`), and no CI configuration runs it: it is run locally.

## Running it

```sh
pnpm e2e
```

The command builds the UI and a debug build of the app (`pnpm tauri build --debug --no-bundle`), then drives it.

### One-time setup

| Needs | How |
|---|---|
| `tauri-driver` | `cargo install tauri-driver --locked` |
| `msedgedriver` matching your WebView2 runtime | Download it from [Microsoft's WebDriver page](https://developer.microsoft.com/microsoft-edge/tools/webdriver) for the version in `HKLM\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}` (`pv`), and put it on `PATH`, or set `EDGE_DRIVER` to its full path |

If either is missing the run stops at the first step and says what to install.

## What it does

1. Creates a temporary Repository with one commit and an uncommitted edit.
2. Starts `tauri-driver` and the app with `REBASAR_CONFIG_DIR` pointing at a temporary folder, so your own Repositories, Tabs and settings are never touched.
3. Opens the Repository through the app's own `open_folder` command (the native folder dialog cannot be driven).
4. Stages `notes.txt` from the Changes view, types a commit subject and commits.
5. Opens History and checks that the new commit is listed.

## Reading a failure

A failing run prints the step it stopped at and the reason. After a failure it also keeps the scratch folder, whose path it prints, with a screenshot of the app (`failure.png`) and the temporary Repository. A passing run cleans up after itself.
