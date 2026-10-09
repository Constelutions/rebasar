import { useEffect, useState } from "react";

import { TabStrip } from "./components/TabStrip";
import { type ApiError, type CoreApi, type Tab, isApiError } from "./core/api";

interface AppProps {
  api: CoreApi;
  pickFolder: () => Promise<string | null>;
}

export function App({ api, pickFolder }: AppProps) {
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div className="app">
      <header className="title-bar">
        <TabStrip tabs={tabs} />
        <button type="button" onClick={openFolder}>
          Open folder
        </button>
      </header>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
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
