# Rebasar

A desktop Git client for professional developers who work across many repositories, branches and worktrees at the same time.

## Language

**Repository**:
One Git repository, identified by its common git directory. It owns one or more Worktrees.
_Avoid_: Project, folder

**Worktree**:
A checked-out working directory of a Repository, either its main one or a linked one.
_Avoid_: Working copy, checkout

**Branch**:
A named line of work in a Repository. One Branch is one entry however many places it exists: locally, on one or more remotes, or both.
_Avoid_: Local branch / remote branch as separate things (they are the two sides of one Branch)

**Scope**:
Where a setting applies: Global (every Repository) or Repository (one Repository and all its Worktrees, not a single Worktree). A Repository-scoped value overrides the Global one and falls back to it when unset.
_Avoid_: Level, context

**Tab**:
One open Worktree. It is the unit that holds the live status, graph and diff the user is looking at.
_Avoid_: Workspace, window, session

**Group**:
A user-defined, named collection of Repositories. A Repository belongs to at most one Group.
_Avoid_: Folder, category, collection

**Operation in progress**:
A merge, rebase, cherry-pick or revert that Git has paused mid-way and that the user must continue, skip or abort. It belongs to one Worktree and exists only while Git is paused.
_Avoid_: Current action, pending operation

**Mutation**:
A Git command that changes a Repository, run through the system `git` by the mutation queue: one at a time per Repository (across all its Worktrees), with its output streamed to the output panel and cancellable while queued or running. Reads are not mutations.
_Avoid_: Operation (that word means an Operation in progress), action, job

**Destructive Mutation**:
A Mutation that can lose uncommitted or unreferenced work. The core assesses it before it runs and the UI asks for a confirmation that states exactly what will be lost. Every other Mutation is safe and never asks.
_Avoid_: Dangerous operation

**Channel**:
Where a release is published: Beta (built from the `develop` branch and published as GitHub pre-releases, `0.x.y` before 1.0.0 and `1.x.y-beta.N` after) or Stable (`1.x.y` versions, built from `main`).
_Avoid_: Track, stream, ring

**CLI**:
The `rebasar` command, which opens a Worktree of a Repository in the desktop app. It starts the app, or hands the path to the one already running, and exits; it does no Git work of its own.
_Avoid_: Launcher, shell command
