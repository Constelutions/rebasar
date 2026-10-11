# Command palette

Ctrl+P opens the "Search or run…" palette. It lists the commands that apply to the current state, jumps to Tabs and branches, and finds commits. Every user-facing action of the app is a palette command, so a ticket that adds an action registers it here.

## Registering a command

A command is a `PaletteCommand` (`ui/src/palette/registry.ts`). Register commands with the `usePaletteCommands` hook from `ui/src/palette/PaletteProvider.tsx`, in a component or hook that is mounted whenever the commands should exist:

```ts
const commands = useMemo<PaletteCommand[]>(
  () => [
    {
      id: "stashes.create",
      title: "Stash my changes…",
      group: "Stashes",
      keywords: ["save", "park"],
      when: ({ activeTab }) => (activeTab?.status?.unstaged.length ?? 0) > 0,
      run: () => setCreating(true),
    },
  ],
  [setCreating],
);
usePaletteCommands(commands);
```

| Field | Meaning |
|---|---|
| `id` | Unique and stable, namespaced by feature (`history.toggle-mine`). Registering a taken id throws. |
| `title` | An imperative phrase; it is what fuzzy matching runs against. A command whose meaning flips (a toggle) changes its title instead (`Show only my commits` / `Show everyone's commits`). |
| `group` | The feature the command belongs to; shown beside the title and also matched. |
| `keywords` | Extra words the command should be found by; they rank below the title. |
| `shortcut` | Display only. Bind the key itself with `useShortcut` in `ui/src/shortcuts.ts`. |
| `when(context)` | Hides the command when it does not apply. `context` is `{ activeTab, view }`: the Tab in front (with its last status) and the view on show. Absent means always listed. |
| `run(context)` | What the command does. It may be async; a rejection or throw is shown as the app error. The palette closes first. |

Rules of thumb:

- **Where to register.** State that only a view owns (the History filter chips) is registered by that view, so the commands exist exactly while the view is mounted and can close over its state. Actions that are always possible (open a folder, go to a view, window controls) are registered in `ui/src/shellCommands.ts`. A feature with its own folder keeps a `useXCommands` hook next to its components, as `ui/src/history/historyCommands.ts` does.
- **Memoise the array** (or declare it at module level). A new array registers again on every render.
- **Use `when` for the Tab's state**, such as "Continue the rebase" only while an Operation in progress exists, rather than failing when run.
- **Dynamic entries** (one per Tab, one per branch) are just commands built from state; see `useShellCommands`.
- **Test through the palette.** UI tests open it with Ctrl+P, type, and press Enter against the stubbed core (`ui/src/palette.test.tsx`).

## Commit search

Text that matches no command is a commit search. The palette sends it to `CoreApi.findCommits`, which parses it with the same query parser as the History filter (`crates/rebasar-core/src/query.rs`: `author:`, `path:`, `msg:` or bare words, `branch:`, `since:`, `until:`). A query that is one hexadecimal word of 4 to 40 digits also finds commits by the start of their hash, ahead of the message matches. Choosing a result, or the "Search commits for…" row, shows History filtered by that query.

## Branches, Worktrees, Repositories and Tabs

- Tabs (and so open Worktrees and Repositories) are listed as "Go to Tab".
- Branches come from `CoreApi.listBranches` each time the palette opens, and open History with `branch:<name>`.
- "Go to Repositories" and "Go to Worktrees" open those views. The Repositories and Worktrees tickets register one command per Repository or Worktree they list, through the mechanism above.
