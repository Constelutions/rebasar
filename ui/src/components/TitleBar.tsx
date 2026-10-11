import type { AppWindow } from "../shell/appWindow";
import { shortcuts } from "../shortcuts";
import type { OpenTab } from "../useOpenTabs";
import { RepositorySwitcher } from "./RepositorySwitcher";
import { TabStrip } from "./TabStrip";
import { WindowControls } from "./WindowControls";

interface TitleBarProps {
  tabs: OpenTab[];
  activePath: string | undefined;
  appWindow: AppWindow;
  onSelectTab: (path: string) => void;
  onOpenFolder: () => void;
}

export function TitleBar({
  tabs,
  activePath,
  appWindow,
  onSelectTab,
  onOpenFolder,
}: TitleBarProps) {
  return (
    <header className="title-bar" data-tauri-drag-region>
      <RepositorySwitcher tabs={tabs} onSelect={onSelectTab} />
      <TabStrip tabs={tabs} activePath={activePath} onSelect={onSelectTab} />
      <button
        type="button"
        aria-label="Open folder"
        title={`Open folder (${shortcuts.openFolder.label})`}
        className="open-folder"
        onClick={onOpenFolder}
      >
        +
      </button>
      <div className="title-bar-spacer" data-tauri-drag-region />
      <WindowControls appWindow={appWindow} />
    </header>
  );
}
