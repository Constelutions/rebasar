import type { ReactNode } from "react";

import { usePalette } from "../palette/PaletteProvider";
import type { AppWindow } from "../shell/appWindow";
import { shortcuts } from "../shortcuts";
import type { OpenTab } from "../useOpenTabs";
import { Button } from "./Button";
import { RepositorySwitcher } from "./RepositorySwitcher";
import { TabStrip } from "./TabStrip";
import { WindowControls } from "./WindowControls";

interface TitleBarProps {
  tabs: OpenTab[];
  activePath: string | undefined;
  appWindow: AppWindow;
  onSelectTab: (path: string) => void;
  onOpenFolder: () => void;
  /** Shown beside the search box, for what belongs to the Tab in front. */
  actions?: ReactNode;
}

export function TitleBar({
  tabs,
  activePath,
  appWindow,
  onSelectTab,
  onOpenFolder,
  actions,
}: TitleBarProps) {
  const palette = usePalette();

  return (
    <header className="title-bar" data-tauri-drag-region>
      <RepositorySwitcher tabs={tabs} onSelect={onSelectTab} />
      <TabStrip tabs={tabs} activePath={activePath} onSelect={onSelectTab} />
      <Button
        variant="plain"
        type="button"
        aria-label="Open folder"
        title={`Open folder (${shortcuts.openFolder.label})`}
        className="open-folder"
        onClick={onOpenFolder}
      >
        +
      </Button>
      <div className="title-bar-spacer" data-tauri-drag-region />
      {actions}
      <Button variant="plain" type="button" className="palette-trigger" onClick={palette.open}>
        Search or run…
        <kbd>{shortcuts.commandPalette.label}</kbd>
      </Button>
      <WindowControls appWindow={appWindow} />
    </header>
  );
}
