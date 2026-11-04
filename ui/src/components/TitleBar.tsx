import type { ReactNode } from "react";

import type { Channel } from "../channel";
import { usePalette } from "../palette/PaletteProvider";
import type { AppWindow } from "../shell/appWindow";
import { shortcuts } from "../shortcuts";
import type { OpenTab } from "../useOpenTabs";
import { BrandLogo } from "./BrandLogo";
import { Button } from "./Button";
import { RepositorySwitcher } from "./RepositorySwitcher";
import { TabStrip } from "./TabStrip";
import { WindowControls } from "./WindowControls";

interface TitleBarProps {
  tabs: OpenTab[];
  activePath: string | undefined;
  appWindow: AppWindow;
  onSelectTab: (path: string) => void;
  onCloseTab: (path: string) => void;
  onOpenFolder: () => void;
  onShowAbout: () => void;
  /** Unknown until the app's version has been read, so the badge never flashes for a Stable build. */
  channel: Channel | null;
  /** Shown beside the search box, for what belongs to the Tab in front. */
  actions?: ReactNode;
}

export function TitleBar({
  tabs,
  activePath,
  appWindow,
  onSelectTab,
  onCloseTab,
  onOpenFolder,
  onShowAbout,
  channel,
  actions,
}: TitleBarProps) {
  const palette = usePalette();

  return (
    <header className="title-bar" data-tauri-drag-region>
      <Button
        variant="plain"
        type="button"
        aria-label="About Rebasar"
        title="About Rebasar"
        className="brand-button"
        onClick={onShowAbout}
      >
        <BrandLogo />
        {channel === "Beta" && <span className="beta-badge">Beta</span>}
      </Button>
      <RepositorySwitcher tabs={tabs} activePath={activePath} onSelect={onSelectTab} />
      <TabStrip tabs={tabs} activePath={activePath} onSelect={onSelectTab} onClose={onCloseTab} />
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
