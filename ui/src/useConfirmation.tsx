import { type ReactNode, useState } from "react";

import { ConfirmationDialog } from "./components/ConfirmationDialog";
import type { CoreApi, Loss, MutationKind } from "./core/api";

interface ConfirmationText {
  title: string;
  confirmLabel: string;
}

/** What the dialog says for each destructive Mutation; a new one adds its entry here. */
const confirmationTexts: Partial<Record<MutationKind["kind"], ConfirmationText>> = {
  discardChanges: { title: "Discard changes", confirmLabel: "Discard" },
  abortOperation: { title: "Abort the operation", confirmLabel: "Abort" },
  forcePush: { title: "Force push", confirmLabel: "Force push" },
  deleteBranch: { title: "Delete branch", confirmLabel: "Delete" },
  reset: { title: "Reset", confirmLabel: "Reset" },
  dropStash: { title: "Drop stash", confirmLabel: "Drop" },
  removeWorktree: { title: "Remove worktree", confirmLabel: "Remove" },
};

const fallbackText: ConfirmationText = { title: "Are you sure?", confirmLabel: "Continue" };

interface Pending {
  text: ConfirmationText;
  loss: Loss;
  run: () => void;
}

export interface Confirmation {
  /**
   * Runs `run` straight away when the core says the Mutation is safe; otherwise shows what
   * would be lost and runs it only if the user confirms. Resolves once the assessment is
   * done, so a rejection means the assessment failed. `run` handles its own errors.
   */
  confirm(kind: MutationKind, run: () => void): Promise<void>;
  /** Render this wherever the component can show a dialog. */
  dialog: ReactNode;
}

export function useConfirmation(api: CoreApi, worktreePath: string): Confirmation {
  const [pending, setPending] = useState<Pending | null>(null);

  async function confirm(kind: MutationKind, run: () => void) {
    const assessment = await api.assessMutation(worktreePath, kind);
    if (assessment.kind === "safe") {
      run();
      return;
    }
    setPending({
      text: confirmationTexts[kind.kind] ?? fallbackText,
      loss: assessment.loss,
      run,
    });
  }

  const dialog = pending && (
    <ConfirmationDialog
      title={pending.text.title}
      confirmLabel={pending.text.confirmLabel}
      loss={pending.loss}
      onCancel={() => setPending(null)}
      onConfirm={() => {
        setPending(null);
        pending.run();
      }}
    />
  );

  return { confirm, dialog };
}
