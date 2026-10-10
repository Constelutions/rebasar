# Rebasar

A fast, cross-platform desktop Git client for developers who work across many repositories, branches and worktrees at the same time.

The name is a pun on *rebase* and *quasar*; in Spanish, *rebasar* also means "to surpass".

## Status

Pre-alpha. The first alpha targets Windows, with Linux next and macOS later. The UI direction lives in `prototypes/mockups/`.

## Development

Requirements: a system `git` 2.35.0 or newer (the app shows a setup screen at startup when it is missing or older; the pinned version is `MINIMUM_GIT_VERSION` in `crates/rebasar-core/src/git_setup.rs`), [Rust](https://rustup.rs) (stable, MSVC toolchain on Windows), Node.js and [`pnpm`](https://pnpm.io), plus the [Tauri prerequisites](https://tauri.app/start/prerequisites/) for your OS.

| Layout | Purpose |
|---|---|
| `crates/rebasar-core` | Rust core: owns all Git work and exposes the typed command and event surface. |
| `crates/rebasar-testkit` | Builds temporary Repositories with real `git` for tests. |
| `crates/rebasar-bench` | Generates large fixture Repositories and benchmarks the core API against the alpha thresholds. |
| `src-tauri` | Tauri shell that binds the core to the UI. |
| `ui` | React + TypeScript UI. `src/core/api.ts` is the UI's view of the core contract; `src/core/stub.ts` is the fake used in UI tests. |

```sh
pnpm install            # install UI dependencies
pnpm dev                # run the desktop app with hot reload
pnpm test               # core tests (cargo) then UI tests (vitest)
pnpm test:core          # cargo test --workspace
pnpm test:ui            # vitest against the stubbed core
pnpm typecheck          # TypeScript type check
pnpm bench:fixtures     # generate the large fixtures (slow once, then cached)
pnpm bench              # run the benchmarks and print them next to the alpha thresholds
```

The app remembers its Repositories, Groups, open Tabs, window layout and settings in a single `registry.json` in the app's config directory (`%APPDATA%\dev.constelutions.rebasar` on Windows). There is no database; a file that cannot be read is kept as `registry.json.invalid` and the app starts empty.

See [`docs/benchmarks.md`](docs/benchmarks.md) for the fixtures, the thresholds and the results format.

## Documentation

- [`CONTEXT.md`](CONTEXT.md): the project's domain language.
- [`docs/adr/`](docs/adr/): architecture decisions.
- [`docs/command-palette.md`](docs/command-palette.md): how a feature registers its commands in the Ctrl+P palette.
- [`docs/benchmarks.md`](docs/benchmarks.md): large-Repository fixtures and the benchmark harness.
- [`docs/agents/`](docs/agents/): configuration for the agent skills used in this repo.
