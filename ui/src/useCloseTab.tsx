import { useState } from "react";

import { CloseTabDialog } from "./components/CloseTabDialog";
import { operationNames } from "./components/OperationBanner";
import { describeHead } from "./components/TabStrip";
import type { CoreApi } from "./core/api";
import { describeError } from "./core/describeError";
import { useSettings } from "./settings/SettingsContext";
import { type CommitDrafts, emptyDraft } from "./useCommitDrafts";
import type { OpenTab } from "./useOpenTabs";

interface PendingClose {
  open: OpenTab;
  losses: string[];
}

/** Closes a Tab, asking first as often as the "Confirm before closing a Tab" setting says. */
export function useCloseTab(
  api: CoreApi,
  openTabs: OpenTab[],
  drafts: CommitDrafts,
  onError: (message: string) => void,
) {
  const { settings } = useSettings();
  const [pending, setPending] = useState<PendingClose | null>(null);

  function close({ open }: PendingClose) {
    setPending(null);
    drafts.setDraft(open.tab.worktreePath, emptyDraft);
    api.closeTab(open.tab.worktreePath).catch((failure) => onError(describeError(failure)));
  }

  function requestClose(worktreePath: string) {
    const open = openTabs.find((candidate) => candidate.tab.worktreePath === worktreePath);
    if (!open) return;

    const request = { open, losses: lossesOf(open, drafts) };
    const { confirmClose } = settings.tabs;
    const asks =
      confirmClose === "always" || (confirmClose === "whenLost" && request.losses.length > 0);
    if (asks) setPending(request);
    else close(request);
  }

  const dialog = pending && (
    <CloseTabDialog
      tabName={`${pending.open.tab.repositoryName} · ${describeHead(pending.open.tab.head)}`}
      losses={pending.losses}
      onCancel={() => setPending(null)}
      onConfirm={() => close(pending)}
    />
  );

  return { requestClose, dialog };
}

function lossesOf({ tab, operation }: OpenTab, drafts: CommitDrafts): string[] {
  return [
    ...(drafts.hasUnsent(tab.worktreePath) ? ["The commit message you have not committed"] : []),
    ...(operation ? [`The ${operationNames[operation.kind].toLowerCase()} in progress`] : []),
  ];
}
