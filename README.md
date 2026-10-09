# Rebasar

A fast, cross-platform desktop Git client for developers who work across many repositories, branches and worktrees at the same time.

The name is a pun on *rebase* and *quasar*; in Spanish, *rebasar* also means "to surpass".

## Status

Pre-alpha. The first alpha targets Windows, with Linux next and macOS later. The UI direction lives in `prototypes/mockups/`.

## Development

Requirements: a system `git`, [Rust](https://rustup.rs) (stable, MSVC toolchain on Windows), Node.js and [`pnpm`](https://pnpm.io), plus the [Tauri prerequisites](https://tauri.app/start/prerequisites/) for your OS.

| Layout | Purpose |
|---|---|
| `crates/rebasar-core` | Rust core: owns all Git work and exposes the typed command and event surface. |
| `crates/rebasar-testkit` | Builds temporary Repositories with real `git` for tests. |
| `src-tauri` | Tauri shell that binds the core to the UI. |
| `ui` | React + TypeScript UI. `src/core/api.ts` is the UI's view of the core contract; `src/core/stub.ts` is the fake used in UI tests. |

```sh
pnpm install            # install UI dependencies
pnpm dev                # run the desktop app with hot reload
pnpm test               # core tests (cargo) then UI tests (vitest)
pnpm test:core          # cargo test --workspace
pnpm test:ui            # vitest against the stubbed core
pnpm typecheck          # TypeScript type check
```

## Documentation

- [`CONTEXT.md`](CONTEXT.md): the project's domain language.
- [`docs/adr/`](docs/adr/): architecture decisions.
- [`docs/agents/`](docs/agents/): configuration for the agent skills used in this repo.
