# Confirmation policy

A Mutation that can lose uncommitted or unreferenced work is a *destructive Mutation*: it asks for a confirmation that states exactly what will be lost. Every other Mutation is *safe* and never prompts. There is no undo ([ADR 0003](adr/0003-no-undo.md)), so the dialog also says that Git's reflog is the only recovery path.

The classification lives in one place, the core, so the UI never decides case by case.

## How it works

1. The UI describes the Mutation it is about to request as a `MutationKind` (`crates/rebasar-core/src/safety.rs`, mirrored in `ui/src/core/api.ts`).
2. `Core::assess_mutation` returns `Assessment::Safe`, or `Assessment::Destructive { loss }` where `Loss` holds the files with uncommitted work, the commits that would become unreachable, and how many of those commits exist on no remote. A destructive Mutation that would lose nothing right now is assessed as safe.
3. `useConfirmation` (`ui/src/useConfirmation.tsx`) runs the Mutation straight away for a safe assessment, and otherwise shows `ConfirmationDialog` with the loss. The Mutation runs only if the user confirms. Cancel is focused by default and Escape cancels.

The core recomputes what to discard when the Mutation actually runs, and the UI passes the paths the user confirmed, so a file that changed in between is never discarded unseen.

## Declaring a destructive Mutation

1. Add a variant to `MutationKind` in `safety.rs`, carrying only what is needed to work out its loss.
2. Decide it in the `match` in `safety::assess`. The match is exhaustive, so the compiler refuses an unclassified variant. Safe variants return `Assessment::Safe`; destructive ones build a `Loss`.
3. Add the Mutation as a `Core` method that runs through the mutation runner, plus its Tauri command and the `CoreApi` contract (`api.ts`, `tauri.ts`, `stub.ts`).
4. Mirror the variant in the `MutationKind` type in `ui/src/core/api.ts`, and make the stub's `assessMutation` return a loss for it.
5. Add an entry for its dialog title and confirm button in `confirmationTexts` in `ui/src/useConfirmation.tsx`. If the Mutation affects people beyond the user, such as deleting a remote branch, also return a sentence for it from `warningFor` in the same file; the dialog shows it under the loss.
6. Call it from the UI as `confirm(kind, run)` using the hook, never `run` directly:

```tsx
const { confirm, dialog } = useConfirmation(api, tab.worktreePath);

void confirm({ kind: "discardChanges", paths }, () => void api.discardChanges(tab.worktreePath, paths));

return <>{/* ... */}{dialog}</>;
```

7. Test the loss at the core seam (`crates/rebasar-core/tests/safety.rs` has the pattern) and the dialog wording at the UI seam (`ui/src/confirmation.test.tsx`).

`Loss.commits` and `Loss.unpushed_commits` are part of the contract for the Mutations that discard commits (reset, branch delete, rebase abort); the dialog already renders them when non-zero. `Loss.commit_list` names the newest of those commits (id and subject) so the dialog can list them, followed by "and N more" when `commits` exceeds the list. Fill it only for a Mutation whose lost commits are worth naming, such as deleting a remote branch; it is empty otherwise.
