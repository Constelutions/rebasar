# Releasing

The reasoning is in [ADR-0004](adr/0004-beta-and-stable-release-channels.md). This page is how to do it.

## The branches

| Branch | What it carries | Releases it publishes |
|---|---|---|
| `develop` | All work. Feature and fix PRs squash-merge here. It is the default branch. | Pre-releases: `v0.x.y` before 1.0.0, then `v1.x.y-beta.N`. |
| `main` | Unreleased until 1.0.0, then stable only. | Stable releases `v1.x.y`. |

Both are protected: changes arrive only through pull requests with the CI checks passing. The `develop` → `main` promotion PR uses a **merge commit**, never a squash, or the two branches diverge for good. After a hotfix on `main`, merge `main` back into `develop`.

## Cutting a release

A release is triggered by merging a pull request that raises the version, and by nothing else.

1. Open a PR into `develop` titled `chore(release): 0.2.0` that changes only `version` under `[workspace.package]` in the root `Cargo.toml`. That is the only place the version is written; the app, the CLI and the installers all take it from there.
2. Get the checks to pass and merge it.
3. The **Release** workflow runs on the push. It plans the release, builds the installers on Windows and Linux, and publishes the GitHub Release with the installers and `SHA256SUMS`. The release notes are generated from the titles of the PRs merged since the previous release.

Every other merge runs the same workflow, finds that `v<version>` already exists, and stops after the planning job.

| Pushed to | Version | Result |
|---|---|---|
| `develop` | `0.x.y` with no tag yet | Pre-release; goes to winget |
| `develop` | `1.x.y-beta.N` with no tag yet | Pre-release; not sent to winget |
| `develop` | a bare `1.x.y` | Error: that belongs on `main` |
| `main` | `1.x.y` with no tag yet | Stable release; goes to winget |
| `main` | `0.x.y` or a suffixed version | Error: `main` is stable only |
| either | the tag already exists | Nothing |

### Going to 1.0.0

Open a PR from `develop` into `main` that sets the version to `1.0.0` and merge it with a **merge commit**. Before that: Windows code signing must be in place, since the beta ships unsigned.

### Publishing is off until you turn it on

Real publishing is guarded by the repository **variable** `RELEASES_ENABLED`. Until it is `true`, the Release workflow still plans and builds everything, then writes what it would have published to the run summary and stops. Set it (Settings → Secrets and variables → Actions → Variables) when the first release should go out.

To rehearse, run the **Release** workflow by hand from the Actions tab. A manual run is a dry run unless you untick `dry_run` and the variable is `true`. The **Build installers** workflow can also be run alone; it builds the installers and uploads them as workflow artifacts without any release logic.

### When a run fails

Re-run the failed jobs. The release is created as a **draft** and published as the last step, so a run that fails halfway leaves no tag, and a draft left behind is replaced by the next attempt. If the release was already published, the run says so and stops.

## The assets

The names are a contract: the marketing site renders its download buttons from them and winget points at them. `scripts/release/plan.mjs` checks them on every build, and fails the run if one is missing or misnamed, or if `SHA256SUMS` does not list exactly these files with matching hashes.

| File | Platform |
|---|---|
| `Rebasar_<version>_x64-setup.exe` | Windows x64, per-user NSIS installer |
| `Rebasar_<version>_amd64.AppImage` | Linux x86_64 |
| `Rebasar_<version>_amd64.deb` | Debian and Ubuntu x86_64 |
| `SHA256SUMS` | One `sha256sum` line per file above |

`<version>` is the workspace version without the leading `v`, so `v0.2.0` ships `Rebasar_0.2.0_...`. Pre-releases are not returned by GitHub's `releases/latest`, so anything that reads releases must list them and pick the newest.

## Repository settings and secrets

| Setting | Kind | Needed for |
|---|---|---|
| `RELEASES_ENABLED` | Variable | Turns real publishing on. Anything other than `true` is a dry run. |
| `SITE_DEPLOY_WEBHOOK` | Secret, optional | A URL the workflow `POST`s to after publishing, so the website rebuilds. A missing secret skips the step, and a failing call never undoes a release. |

The workflow publishes with the built-in `GITHUB_TOKEN`. If the organisation restricts workflow permissions, allow the Release workflow's `publish` job to write to contents.

## Building installers on your machine

```sh
pnpm bundle
```

This builds the `rebasar` CLI, copies it where Tauri expects a bundled binary, and runs `tauri build` with an overlay config that declares it. The installer lands in `target/release/bundle/`. It needs the same prerequisites as development, and on Linux the system packages the CI installs (`libwebkit2gtk-4.1-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev`, `libxdo-dev`, `libssl-dev`, `build-essential`).

The CLI is declared only in the overlay because Tauri checks that a bundled binary exists whenever the app crate compiles, which would break `cargo test` and `pnpm dev`. Plain `pnpm tauri build` therefore builds an installer without the CLI.

## What the installers do

- **Windows** installs per user without an administrator prompt, puts `rebasar.exe` and `rebasar-app.exe` side by side, and adds the install folder to the user's `PATH`. Uninstalling removes it again and restores the `PATH` value exactly.
- **`.deb`** installs `rebasar` and `rebasar-app` into `/usr/bin` and depends on `git`.
- **AppImage** has no `PATH` integration. It accepts a path argument itself.

The desktop executable is called `rebasar-app` on purpose: Windows filenames are case-insensitive, so it must never be `Rebasar.exe` beside the CLI's `rebasar.exe`.

## Known gaps

- Windows installers are **not signed**, so SmartScreen warns. Signing is required before `v1.0.0`.
- There is no in-app update; users install the next version.
- Winget submission is not part of the workflow yet.
