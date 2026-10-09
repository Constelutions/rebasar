import { useEffect, useState } from "react";

import { Sidebar } from "./components/Sidebar";
import { TitleBar } from "./components/TitleBar";
import { ViewPane } from "./components/ViewPane";
import { type ApiError, type CoreApi, type Tab, isApiError } from "./core/api";
import type { AppWindow } from "./shell/appWindow";
import { shortcuts, useShortcut } from "./shortcuts";
import type { ViewName } from "./views";

interface AppProps {
  api: CoreApi;
  pickFolder: () => Promise<string | null>;
  appWindow: AppWindow;
}

export function App({ api, pickFolder, appWindow }: AppProps) {
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<ViewName>("Home");

  useEffect(() => {
    const subscription = api.onEvent((event) => {
      if (event.type === "tabOpened") {
        setTabs((current) => withTab(current, event.tab));
      }
    });
    return () => {
      void subscription.then((unsubscribe) => unsubscribe());
    };
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
    <div className="app">
      <TitleBar tabs={tabs} appWindow={appWindow} onOpenFolder={openFolder} />
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="app-body">
        <Sidebar selected={view} onSelect={setView} />
        <ViewPane view={view} />
      </div>
    </div>
  );
}

function withTab(tabs: Tab[], opened: Tab): Tab[] {
  const others = tabs.filter((tab) => tab.worktreePath !== opened.worktreePath);
  return [...others, opened];
}

function describeError(failure: unknown): string {
  if (!isApiError(failure)) return String(failure);
  return describeApiError(failure);
}

function describeApiError(error: ApiError): string {
  switch (error.kind) {
    case "folderNotFound":
      return `${error.path} does not exist.`;
    case "notARepository":
      return `${error.path} is not a Git repository.`;
    case "unexpected":
      return error.message;
  }
}
