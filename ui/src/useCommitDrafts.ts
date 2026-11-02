import { useCallback, useMemo, useState } from "react";

export interface CommitDraft {
  message: string;
}

export const emptyDraft: CommitDraft = { message: "" };

/**
 * The commit message each Tab has typed and not committed. It lives above the views so that moving
 * to another view, which unmounts the composer, neither loses it nor hides it from closing a Tab.
 */
export function useCommitDrafts() {
  const [drafts, setDrafts] = useState<ReadonlyMap<string, CommitDraft>>(new Map());

  const draftOf = useCallback((worktreePath: string) => drafts.get(worktreePath) ?? emptyDraft, [drafts]);

  const setDraft = useCallback(
    (worktreePath: string, draft: CommitDraft) =>
      setDrafts((current) => new Map(current).set(worktreePath, draft)),
    [],
  );

  const hasUnsent = useCallback(
    (worktreePath: string) => draftOf(worktreePath).message.trim() !== "",
    [draftOf],
  );

  return useMemo(() => ({ draftOf, setDraft, hasUnsent }), [draftOf, setDraft, hasUnsent]);
}

export type CommitDrafts = ReturnType<typeof useCommitDrafts>;
