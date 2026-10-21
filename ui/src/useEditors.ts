import { useCallback, useEffect, useMemo, useState } from "react";

import type { CoreApi, Editor, FileChange } from "./core/api";
import { describeError } from "./core/describeError";
import { usePaletteCommands } from "./palette/PaletteProvider";
import type { PaletteCommand } from "./palette/registry";
import { useSettings } from "./settings/SettingsContext";

/**
 * The editors of this OS and the one the user chose last, shared by everything that opens something in
 * an editor so that a choice made in one place is the default in the others. `onError` must be stable.
 */
export function useEditors(api: CoreApi, onError: (message: string) => void) {
  const { settings, update } = useSettings();
  const [editors, setEditors] = useState<Editor[]>([]);

  useEffect(() => {
    let current = true;
    api.listEditors().then(
      (listed) => current && setEditors(listed),
      (failure) => current && onError(describeError(failure)),
    );
    return () => {
      current = false;
    };
  }, [api, onError]);

  const lastUsed = settings.editor.lastUsed;
  const remember = useCallback(
    (editorId: string) => {
      if (lastUsed !== editorId) update({ ...settings, editor: { lastUsed: editorId } });
    },
    [lastUsed, settings, update],
  );

  return { editors, lastUsed, remember };
}

/** What a list of changed files needs to offer "Open file in…" on each row. */
export interface FileOpener {
  editors: Editor[];
  lastUsed: string | null;
  open: (editor: Editor, change: FileChange) => void;
}

export const NOTHING_TO_OPEN = "A deleted file has nothing to open.";

export function canOpen(change: FileChange): boolean {
  return change.kind !== "deleted";
}

/**
 * Opens files of one Worktree in an editor and offers the file in front in the command palette.
 * `onError` must be stable.
 */
export function useFileOpener(
  api: CoreApi,
  worktreePath: string,
  selected: FileChange | null,
  onError: (message: string) => void,
): FileOpener {
  const { editors, lastUsed, remember } = useEditors(api, onError);

  const open = useCallback(
    (editor: Editor, change: FileChange) => {
      api.openFileInEditor(editor.id, worktreePath, change.path).then(
        () => remember(editor.id),
        (failure) => onError(describeError(failure)),
      );
    },
    [api, worktreePath, remember, onError],
  );

  const commands = useMemo<PaletteCommand[]>(
    () =>
      selected && canOpen(selected)
        ? editors
            .filter((editor) => editor.available)
            .map((editor) => ({
              id: `editor.open-file.${editor.id}`,
              title: `Open selected file in ${editor.label}`,
              group: "Worktree",
              keywords: ["editor", "file"],
              run: () => open(editor, selected),
            }))
        : [],
    [editors, selected, open],
  );
  usePaletteCommands(commands);

  return useMemo(() => ({ editors, lastUsed, open }), [editors, lastUsed, open]);
}
