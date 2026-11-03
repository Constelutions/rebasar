# Rebasar

A fast, cross-platform desktop Git client for developers who work across many repositories, branches and worktrees at the same time.

The name is a pun on *rebase* and *quasar*; in Spanish, *rebasar* also means "to surpass".

## Status

Beta in preparation, targeting Windows and Linux; macOS is later. Releases and the branch model are described in [`docs/adr/0004-beta-and-stable-release-channels.md`](docs/adr/0004-beta-and-stable-release-channels.md). The UI direction lives in `prototypes/mockups/`.

## Install

Download the installer for your platform from the [Releases page](https://github.com/Constelutions/rebasar/releases). Beta builds are marked as pre-releases, and every release lists a `SHA256SUMS` file to check your download against.

| Platform (x64) | Download | Install |
|---|---|---|
| Windows 10 and 11 | `Rebasar_<version>_x64-setup.exe` | Run it. It installs for your user only and needs no administrator rights. Once the package has been accepted, `winget install Constelutions.Rebasar` does the same. |
| Debian and Ubuntu | `Rebasar_<version>_amd64.deb` | `sudo apt install ./Rebasar_<version>_amd64.deb`, which also installs `git`. |
| Any other Linux | `Rebasar_<version>_amd64.AppImage` | `chmod +x` it and run it. |

The Linux builds need glibc 2.34 or newer and WebKitGTK 4.1, which means Ubuntu 22.04 or newer, Debian 12 or newer, or a distribution of the same age; Ubuntu 20.04 and Debian 11 are not supported. Rebasar needs a system `git` 2.35.0 or newer and shows a setup screen when it is missing or older. Debian 12 and Ubuntu 24.04 ship a new enough one; Ubuntu 22.04 ships 2.34, so install a newer one from the [Git PPA](https://launchpad.net/~git-core/+archive/ubuntu/ppa).

The beta installers for Windows are not code-signed yet, so SmartScreen may show "Windows protected your PC". Choose **More info**, then **Run anyway**.

### The `rebasar` command

The Windows installer and the `.deb` also install a `rebasar` command (the Windows installer adds it to your `PATH`, so open a new terminal after installing).

```sh
rebasar                 # open Rebasar, restoring your last session
rebasar .               # open the Worktree that contains the current folder
rebasar ~/work/api      # open the Worktree that contains a path, from anywhere
rebasar help            # show the usage; rebasar --version prints the version
```

A path inside a Git worktree opens that whole Worktree, a linked Worktree opens itself, and anything else is refused with a one-line explanation and exit code 1. If Rebasar is already running, the Worktree opens in that window rather than in a second one. The AppImage has no `rebasar` command, but it accepts a path itself: `Rebasar_<version>_amd64.AppImage ~/work/api`.

### Known limitations of the beta

- **Linux does not store credentials yet.** To use GitHub pull requests there, sign in with the GitHub CLI (`gh auth login`); pasting a personal access token is only offered on Windows.
- Windows installers are unsigned, as above.

### Reporting a problem

Open an issue on the [issue tracker](https://github.com/Constelutions/rebasar/issues), or use **Report an issue** in the command palette (Ctrl+P), which opens the same page. **About Rebasar** there shows the version to include.

## Development

Requirements: a system `git` 2.35.0 or newer (the app shows a setup screen at startup when it is missing or older; the pinned version is `MINIMUM_GIT_VERSION` in `crates/rebasar-core/src/git_setup.rs`), [Rust](https://rustup.rs) (stable, MSVC toolchain on Windows), Node.js and [`pnpm`](https://pnpm.io), plus the [Tauri prerequisites](https://tauri.app/start/prerequisites/) for your OS.

| Layout | Purpose |
|---|---|
| `crates/rebasar-core` | Rust core: owns all Git work and exposes the typed command and event surface. |
| `crates/rebasar-testkit` | Builds temporary Repositories with real `git` for tests. |
| `crates/rebasar-bench` | Generates large fixture Repositories and benchmarks the core API against the alpha thresholds. |
| `crates/rebasar-cli` | The `rebasar` command: checks a path is inside a Git worktree and starts the desktop app on it. |
| `src-tauri` | Tauri shell that binds the core to the UI. |
| `scripts` | The installer build script and the release-plan script, with its tests. |
| `ui` | React + TypeScript UI. `src/core/api.ts` is the UI's view of the core contract; `src/core/stub.ts` is the fake used in UI tests. |
| `site` | The marketing website: a standalone Astro project, outside the pnpm workspace, deployed from its own Dockerfile. |

```sh
pnpm install            # install UI dependencies
pnpm dev                # run the desktop app with hot reload
pnpm test               # core tests (cargo), UI tests (vitest), then the script tests
pnpm test:core          # cargo test --workspace
pnpm test:ui            # vitest against the stubbed core
pnpm test:scripts       # the release-plan script's tests (node --test)
pnpm typecheck          # TypeScript type check
pnpm bundle             # build the installers for this OS, with the CLI bundled (see docs/releasing.md)
pnpm bench:fixtures     # generate the large fixtures (slow once, then cached)
pnpm bench              # run the benchmarks and print them next to the alpha thresholds
```

The app remembers its Repositories, Groups, open Tabs, window layout and settings in a single `registry.json` in the app's config directory (`%APPDATA%\dev.constelutions.rebasar` on Windows). There is no database; a file that cannot be read is kept as `registry.json.invalid` and the app starts empty.

See [`docs/benchmarks.md`](docs/benchmarks.md) for the fixtures, the thresholds and the results format.

## Documentation

- [`CONTEXT.md`](CONTEXT.md): the project's domain language.
- [`docs/adr/`](docs/adr/): architecture decisions.
- [`docs/command-palette.md`](docs/command-palette.md): how a feature registers its commands in the Ctrl+P palette.
- [`docs/confirmation-policy.md`](docs/confirmation-policy.md): which Mutations ask for confirmation and how a new one declares itself.
- [`docs/benchmarks.md`](docs/benchmarks.md): large-Repository fixtures and the benchmark harness.
- [`docs/releasing.md`](docs/releasing.md): how a release is cut, the branches, the asset names and the repository settings it needs.
- [`docs/smoke-run.md`](docs/smoke-run.md): the end-to-end sanity run and the manual single-instance checks.
- [`site/README.md`](site/README.md): the marketing website, how to run it and how it is deployed.
- [`site/README.md`](site/README.md): the marketing website, how to run it and how it is deployed.
- [`docs/agents/`](docs/agents/): configuration for the agent skills used in this repo.

## License

Rebasar is licensed under the [Apache License 2.0](LICENSE).
