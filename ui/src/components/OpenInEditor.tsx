import { useCallback, useMemo, useRef, useState } from "react";

import type { CoreApi, Editor } from "../core/api";
import { describeError } from "../core/describeError";
import { usePaletteCommands } from "../palette/PaletteProvider";
import type { PaletteCommand } from "../palette/registry";
import { useDismiss } from "../useDismiss";
import { useEditors } from "../useEditors";
import { ActionIcon } from "./ActionIcons";
import { Button } from "./Button";
import { ChevronIcon } from "./ChevronIcon";

interface OpenInEditorProps {
  api: CoreApi;
  worktreePath: string;
  onError: (message: string) => void;
}

/** Opens the Tab in front in an editor: the main button uses the last editor chosen, the arrow lists them all. */
export function OpenInEditor({ api, worktreePath, onError }: OpenInEditorProps) {
  const { editors: everyEditor, lastUsed, remember } = useEditors(api, onError);
  const [menuOpen, setMenuOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  useDismiss(menuOpen, container, closeMenu);

  const editors = useMemo(() => everyEditor.filter((editor) => editor.opensFolders), [everyEditor]);
  const usable = useMemo(() => editors.filter((editor) => editor.available), [editors]);
  const defaultEditor = usable.find((editor) => editor.id === lastUsed) ?? usable[0];

  const open = useCallback(
    async (editor: Editor) => {
      setMenuOpen(false);
      try {
        await api.openInEditor(editor.id, worktreePath);
      } catch (failure) {
        onError(describeError(failure));
        return;
      }
      remember(editor.id);
    },
    [api, worktreePath, onError, remember],
  );

  const commands = useMemo<PaletteCommand[]>(
    () =>
      usable.map((editor) => ({
        id: `editor.open.${editor.id}`,
        title: `Open Worktree in ${editor.label}`,
        group: "Worktree",
        keywords: ["editor", "code"],
        run: () => open(editor),
      })),
    [usable, open],
  );
  usePaletteCommands(commands);

  return (
    <div ref={container} className="open-in-editor" role="group" aria-label="Open in editor">
      <Button
        className="icon-button open-in-editor-main"
        aria-label={defaultEditor ? `Open in ${defaultEditor.label}` : "Open in editor"}
        disabled={defaultEditor === undefined}
        title={defaultEditor ? `Open this Worktree in ${defaultEditor.label}` : "No supported editor was found on the PATH"}
        onClick={() => defaultEditor && void open(defaultEditor)}
      >
        <ActionIcon name="openIn" />
      </Button>
      <Button
        className="open-in-editor-toggle"
        aria-label="Choose editor"
        title="Choose editor"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((current) => !current)}
      >
        <ChevronIcon direction="down" />
      </Button>
      {menuOpen && (
        <div role="menu" aria-label="Editors" className="open-in-editor-menu">
          {editors.map((editor) => (
            <Button
              variant="plain"
              key={editor.id}
              role="menuitem"
              disabled={!editor.available}
              title={editor.unavailableReason ?? undefined}
              onClick={() => void open(editor)}
            >
              {editor.label}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
