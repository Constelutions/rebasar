import { useCallback, useEffect, useMemo, useState } from "react";

import { issuesUrl } from "./about";
import { channelOf } from "./channel";
import { AboutDialog } from "./components/AboutDialog";
import { type AddKind, AddRepositoryDialog } from "./components/AddRepositoryDialog";
import { OpenInEditor } from "./components/OpenInEditor";
import { OperationBanner } from "./components/OperationBanner";
import { SyncControls } from "./components/SyncControls";
import { OutputPanel } from "./components/OutputPanel";
import { SetupScreen } from "./components/SetupScreen";
import { Sidebar } from "./components/Sidebar";
import { TitleBar } from "./components/TitleBar";
import { type CommitSearch, ViewPane } from "./components/ViewPane";
import type { CoreApi, GitSetup } from "./core/api";
import { describeError } from "./core/describeError";
import { type Highlighter, HighlighterProvider, defaultHighlighter } from "./highlight/highlighter";
import { PaletteProvider } from "./palette/PaletteProvider";
import type { PaletteContext } from "./palette/registry";
import { SettingsProvider, useSettings, useStoredSettings } from "./settings/SettingsContext";
import type { AppWindow } from "./shell/appWindow";
import { shortcuts, useShortcut } from "./shortcuts";
import { useShellCommands } from "./shellCommands";
import { useAppInfo } from "./useAppInfo";
import { useCloseTab } from "./useCloseTab";
import { type CommitDrafts, useCommitDrafts } from "./useCommitDrafts";
import { useMutations } from "./useMutations";
import { type OpenTab, useOpenTabs } from "./useOpenTabs";
import { isViewName, type ViewName } from "./views";

interface AppProps {
  api: CoreApi;
  pickFolder: () => Promise<string | null>;
  appWindow: AppWindow;
  highlighter?: Highlighter;
}

export function App({ api, pickFolder, appWindow, highlighter = defaultHighlighter }: AppProps) {
  const { openTabs, activeTab, pollingPaths, restoredView, error, setError, select } =
    useOpenTabs(api);
  const [view, setView] = useState<ViewName>("Home");
  const [commitSearch, setCommitSearch] = useState<CommitSearch>({ query: "", id: 0 });
  const [gitSetup, setGitSetup] = useState<GitSetup | null>(null);
  const [adding, setAdding] = useState<AddKind | null>(null);
  const [repositoriesVersion, setRepositoriesVersion] = useState(0);
  const runs = useMutations(api);
  const commitDrafts = useCommitDrafts();
  const storedSettings = useStoredSettings(api);

  useEffect(() => {
    // `pnpm bench:app` reads this to time the app itself, without the WebDriver's attach time.
    performance.mark("rebasar-interactive");
  }, []);

  useEffect(() => {
    api
      .checkGit()
      .then(setGitSetup)
      .catch((failure) => setError(describeError(failure)));
  }, [api, setError]);

  useEffect(() => {
    if (isViewName(restoredView)) setView(restoredView);
  }, [restoredView]);

  const changeView = useCallback(
    (next: ViewName) => {
      setView(next);
      api.saveView(next).catch((failure) => setError(describeError(failure)));
    },
    [api, setError],
  );

  const openFolder = useCallback(async () => {
    const path = await pickFolder();
    if (path === null) return;

    setError(null);
    try {
      await api.openFolder(path);
    } catch (failure) {
      setError(describeError(failure));
    }
  }, [api, pickFolder, setError]);

  const showCommits = useCallback((query: string) => {
    setCommitSearch((current) => ({ query, id: current.id + 1 }));
    setView("History");
  }, []);

  const repositoriesChanged = useCallback(() => setRepositoriesVersion((version) => version + 1), []);

  const paletteContext = useMemo<PaletteContext>(() => ({ activeTab, view }), [activeTab, view]);

  useShortcut(shortcuts.openFolder, openFolder);
  useShortcut(shortcuts.openSettings, () => setView("Settings"));

  return (
    <SettingsProvider value={storedSettings}>
      <HighlighterProvider value={highlighter}>
        <PaletteProvider
          api={api}
          context={paletteContext}
          onShowCommits={showCommits}
          onError={(failure) => setError(describeError(failure))}
        >
          <Shell
            api={api}
            appWindow={appWindow}
            openTabs={openTabs}
            activeTab={activeTab}
            pollingPaths={pollingPaths}
            error={error}
            view={view}
            commitSearch={commitSearch}
            gitSetup={gitSetup}
            runs={runs}
            commitDrafts={commitDrafts}
            openFolder={openFolder}
            selectTab={select}
            showView={changeView}
            pickFolder={pickFolder}
            showCommits={showCommits}
            adding={adding}
            onAdd={setAdding}
            repositoriesVersion={repositoriesVersion}
            onRepositoriesChanged={repositoriesChanged}
            onError={setError}
          />
        </PaletteProvider>
      </HighlighterProvider>
    </SettingsProvider>
  );
}

interface ShellProps {
  api: CoreApi;
  appWindow: AppWindow;
  openTabs: OpenTab[];
  activeTab: OpenTab | undefined;
  pollingPaths: string[];
  error: string | null;
  view: ViewName;
  commitSearch: CommitSearch;
  gitSetup: GitSetup | null;
  runs: ReturnType<typeof useMutations>;
  commitDrafts: CommitDrafts;
  openFolder: () => void;
  selectTab: (worktreePath: string) => void;
  showView: (view: ViewName) => void;
  pickFolder: () => Promise<string | null>;
  showCommits: (query: string) => void;
  adding: AddKind | null;
  onAdd: (kind: AddKind | null) => void;
  repositoriesVersion: number;
  onRepositoriesChanged: () => void;
  onError: (message: string) => void;
}

function Shell({
  api,
  appWindow,
  openTabs,
  activeTab,
  pollingPaths,
  error,
  view,
  commitSearch,
  gitSetup,
  runs,
  commitDrafts,
  openFolder,
  selectTab,
  showView,
  pickFolder,
  showCommits,
  adding,
  onAdd,
  repositoriesVersion,
  onRepositoriesChanged,
  onError,
}: ShellProps) {
  const { requestClose, dialog: closeTabDialog } = useCloseTab(api, openTabs, commitDrafts, onError);
  const { settings, update: updateSettings } = useSettings();
  const sidebarCollapsed = settings.appearance.sidebarCollapsed;
  const toggleSidebar = useCallback(
    () =>
      updateSettings({
        ...settings,
        appearance: { ...settings.appearance, sidebarCollapsed: !sidebarCollapsed },
      }),
    [settings, sidebarCollapsed, updateSettings],
  );

  const appInfo = useAppInfo(api, onError);
  const [aboutOpen, setAboutOpen] = useState(false);
  const showAbout = useCallback(() => setAboutOpen(true), []);
  const reportIssue = useCallback(
    () => api.openInBrowser(issuesUrl).catch((failure) => onError(describeError(failure))),
    [api, onError],
  );

  useShellCommands({
    api,
    appWindow,
    openTabs,
    activeTab,
    view,
    openFolder,
    selectTab,
    closeTab: requestClose,
    showView,
    showCommits,
    addRepository: onAdd,
    sidebarCollapsed,
    toggleSidebar,
    showAbout,
    reportIssue,
  });

  return (
    <div className="app">
      <TitleBar
        tabs={openTabs}
        activePath={activeTab?.tab.worktreePath}
        appWindow={appWindow}
        onSelectTab={selectTab}
        onCloseTab={requestClose}
        onOpenFolder={openFolder}
        onShowAbout={showAbout}
        channel={appInfo && channelOf(appInfo.version)}
        actions={
          activeTab && (
            <>
              <OpenInEditor
                api={api}
                worktreePath={activeTab.tab.worktreePath}
                onError={onError}
              />
              <SyncControls
                key={activeTab.tab.worktreePath}
                api={api}
                worktreePath={activeTab.tab.worktreePath}
                onError={onError}
              />
            </>
          )
        }
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
          {activeTab?.operation && (
            <OperationBanner
              key={activeTab.tab.worktreePath}
              api={api}
              worktreePath={activeTab.tab.worktreePath}
              operation={activeTab.operation}
            />
          )}
          <div className="app-body">
            <Sidebar
              selected={view}
              collapsed={sidebarCollapsed}
              onSelect={showView}
              onToggleCollapsed={toggleSidebar}
              version={appInfo?.version}
              onShowAbout={showAbout}
            />
            <ViewPane
              view={view}
              api={api}
              tab={activeTab}
              commitSearch={commitSearch}
              pickFolder={pickFolder}
              onAddRepository={onAdd}
              onNavigate={showView}
              repositoriesVersion={repositoriesVersion}
              commitDrafts={commitDrafts}
            />
          </div>
          <OutputPanel runs={runs} onCancel={(run) => void api.cancelMutation(run.id)} />
        </>
      )}
      {closeTabDialog}
      {aboutOpen && (
        <AboutDialog api={api} info={appInfo} onClose={() => setAboutOpen(false)} onError={onError} />
      )}
      {adding && (
        <AddRepositoryDialog
          api={api}
          kind={adding}
          pickFolder={pickFolder}
          onClose={() => onAdd(null)}
          onAdded={onRepositoriesChanged}
          onFailure={onError}
        />
      )}
    </div>
  );
}
