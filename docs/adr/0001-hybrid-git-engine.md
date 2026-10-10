# Read through gitoxide, mutate through the system `git` CLI

Read paths (commit graph, status, diff, refs) go through `gix` because they decide the performance targets on very large repositories. Every mutating operation (commit, merge, rebase, push, stash, worktree add) shells out to the user's own `git`, so hooks, signing, credential helpers and SSH config behave exactly as they do in their terminal.

## Considered Options

- **`git` CLI only:** exact parity, but process spawn and text parsing on hot read paths miss the Linux-kernel-scale targets.
- **libgit2:** weaker rebase and merge fidelity, and slower than `gix` on large repositories.
- **`gix` only:** write support for merge and rebase is still incomplete.

## Consequences

A system `git` at a minimum supported version (2.35.0, the oldest the test suite runs against) is required; the app shows a setup screen when it is missing. Bundling `git` is deferred.
