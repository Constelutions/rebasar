import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { CoreApi, Editor } from "../core/api";
import { describeError } from "../core/describeError";
import { usePaletteCommands } from "../palette/PaletteProvider";
import type { PaletteCommand } from "../palette/registry";
import { useSettings } from "../settings/SettingsContext";
import { useDismiss } from "../useDismiss";
import { Button } from "./Button";

interface OpenInEditorProps {
  api: CoreApi;
  worktreePath: string;
  onError: (message: string) => void;
}

/** Opens the Tab in front in an editor: the main button uses the last editor chosen, the arrow lists them all. */
export function OpenInEditor({ api, worktreePath, onError }: OpenInEditorProps) {
  const { settings, update } = useSettings();
  const [editors, setEditors] = useState<Editor[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  useDismiss(menuOpen, container, closeMenu);

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

  const usable = useMemo(() => editors.filter((editor) => editor.available), [editors]);
  const defaultEditor = usable.find((editor) => editor.id === settings.editor.lastUsed) ?? usable[0];

  const open = useCallback(
    async (editor: Editor) => {
      setMenuOpen(false);
      try {
        await api.openInEditor(editor.id, worktreePath);
      } catch (failure) {
        onError(describeError(failure));
        return;
      }
      if (settings.editor.lastUsed !== editor.id) {
        update({ ...settings, editor: { lastUsed: editor.id } });
      }
    },
    [api, worktreePath, onError, settings, update],
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
        className="open-in-editor-main"
        disabled={defaultEditor === undefined}
        title={defaultEditor ? `Open this Worktree in ${defaultEditor.label}` : "No supported editor was found on the PATH"}
        onClick={() => defaultEditor && void open(defaultEditor)}
      >
        {defaultEditor ? `Open in ${defaultEditor.label}` : "Open in editor"}
      </Button>
      <Button
        className="open-in-editor-toggle"
        aria-label="Choose editor"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((current) => !current)}
      >
        <span aria-hidden="true">▾</span>
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
