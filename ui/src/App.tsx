import { useState } from "react";

import { Sidebar } from "./components/Sidebar";
import { TitleBar } from "./components/TitleBar";
import { ViewPane } from "./components/ViewPane";
import type { CoreApi } from "./core/api";
import { describeError } from "./core/describeError";
import { type Highlighter, HighlighterProvider, defaultHighlighter } from "./highlight/highlighter";
import type { AppWindow } from "./shell/appWindow";
import { shortcuts, useShortcut } from "./shortcuts";
import { useOpenTabs } from "./useOpenTabs";
import type { ViewName } from "./views";

interface AppProps {
  api: CoreApi;
  pickFolder: () => Promise<string | null>;
  appWindow: AppWindow;
  highlighter?: Highlighter;
}

export function App({ api, pickFolder, appWindow, highlighter = defaultHighlighter }: AppProps) {
  const { openTabs, activeTab, pollingPaths, error, setError, select } = useOpenTabs(api);
  const [view, setView] = useState<ViewName>("Home");

  async function openFolder() {
    const path = await pickFolder();
    if (path === null) return;

    setError(null);
    try {
      await api.openFolder(path);
    } catch (failure) {
      setError(describeError(failure));
    }
  }

  useShortcut(shortcuts.openFolder, openFolder);

  return (
    <HighlighterProvider value={highlighter}>
      <div className="app">
        <TitleBar
          tabs={openTabs}
          activePath={activeTab?.tab.worktreePath}
          appWindow={appWindow}
          onSelectTab={select}
          onOpenFolder={openFolder}
        />
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {pollingPaths.length > 0 && (
          <p role="status" className="notice">
            The operating system's file-watch limit was reached, so {pollingPaths.length}{" "}
            {pollingPaths.length === 1 ? "Tab is" : "Tabs are"} checked periodically instead of live,
            starting with the ones used least recently.
          </p>
        )}
        <div className="app-body">
          <Sidebar selected={view} onSelect={setView} />
          <ViewPane view={view} api={api} tab={activeTab} />
        </div>
      </div>
    </HighlighterProvider>
  );
}
