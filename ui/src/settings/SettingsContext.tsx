import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

import { type CoreApi, type Settings, defaultSettings } from "../core/api";
import { describeError } from "../core/describeError";

export interface SettingsState {
  settings: Settings;
  /** False until the stored settings have been read, so nothing renders with stand-in values. */
  ready: boolean;
  error: string | null;
  update: (settings: Settings) => void;
}

const SettingsContext = createContext<SettingsState>({
  settings: defaultSettings,
  ready: true,
  error: null,
  update: () => {},
});

export const SettingsProvider = SettingsContext.Provider;

export function useSettings() {
  return useContext(SettingsContext);
}

export function useStoredSettings(api: CoreApi): SettingsState {
  const [settings, setSettings] = useState(defaultSettings);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latestUpdate = useRef(0);

  useEffect(() => {
    let current = true;
    api
      .settings()
      .then((stored) => current && setSettings(stored))
      .catch((failure) => current && setError(describeError(failure)))
      .finally(() => current && setReady(true));
    return () => {
      current = false;
    };
  }, [api]);

  useEffect(() => {
    document.documentElement.style.setProperty(
      "--diff-font-size",
      `${settings.appearance.codeFontSize}px`,
    );
  }, [settings.appearance.codeFontSize]);

  const update = useCallback(
    (next: Settings) => {
      const request = ++latestUpdate.current;
      setSettings(next);
      setError(null);
      api
        .updateSettings(next)
        .then((stored) => {
          if (request === latestUpdate.current) setSettings(stored);
        })
        .catch((failure) => setError(describeError(failure)));
    },
    [api],
  );

  return { settings, ready, error, update };
}
