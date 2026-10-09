# No undo in the application

The Concept 6 mockup shows "Undo" on commits and stashes, but the application has no undo at all: no operation journal, no working-tree snapshots, and no undo links. Recording enough state to reverse every local operation is a large, cross-cutting feature, and the alpha is already scoped around performance and breadth of Git operations.

## Consequences

Operations that can lose uncommitted or unreferenced work (discard, `reset --hard`, deleting an unmerged branch, `stash drop`, `rebase --abort`) ask for confirmation that states exactly what will be lost, and force-push always uses `--force-with-lease`. Git's own reflog is the only recovery path, and those dialogs say so. Adding undo later means introducing the journal before any new mutating operation ships, so the cost grows with every operation added.
