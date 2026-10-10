import { useEffect, useState } from "react";

import { OutputPanel } from "./components/OutputPanel";
import { SetupScreen } from "./components/SetupScreen";
import { Sidebar } from "./components/Sidebar";
import { TitleBar } from "./components/TitleBar";
import { ViewPane } from "./components/ViewPane";
import type { CoreApi, GitSetup } from "./core/api";
import { describeError } from "./core/describeError";
import { type Highlighter, HighlighterProvider, defaultHighlighter } from "./highlight/highlighter";
import type { AppWindow } from "./shell/appWindow";
import { shortcuts, useShortcut } from "./shortcuts";
import { useMutations } from "./useMutations";
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
  const [gitSetup, setGitSetup] = useState<GitSetup | null>(null);
  const runs = useMutations(api);

  useEffect(() => {
    api
      .checkGit()
      .then(setGitSetup)
      .catch((failure) => setError(describeError(failure)));
  }, [api]);

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
        {gitSetup && gitSetup.kind !== "ready" ? (
          <SetupScreen setup={gitSetup} />
        ) : (
          <>
            <div className="app-body">
              <Sidebar selected={view} onSelect={setView} />
              <ViewPane view={view} api={api} tab={activeTab} />
            </div>
            <OutputPanel runs={runs} onCancel={(run) => void api.cancelMutation(run.id)} />
          </>
        )}
      </div>
    </HighlighterProvider>
  );
}
