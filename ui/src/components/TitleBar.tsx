import type { Tab } from "../core/api";
import type { AppWindow } from "../shell/appWindow";
import { shortcuts } from "../shortcuts";
import { TabStrip } from "./TabStrip";
import { WindowControls } from "./WindowControls";

interface TitleBarProps {
  tabs: Tab[];
  appWindow: AppWindow;
  onOpenFolder: () => void;
}

export function TitleBar({ tabs, appWindow, onOpenFolder }: TitleBarProps) {
  return (
    <header className="title-bar" data-tauri-drag-region>
      <TabStrip tabs={tabs} />
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
