import { useEffect, useState } from "react";

import type { AppInfo, CoreApi } from "./core/api";
import { describeError } from "./core/describeError";

export function useAppInfo(api: CoreApi, onError: (message: string) => void): AppInfo | null {
  const [info, setInfo] = useState<AppInfo | null>(null);

  useEffect(() => {
    let current = true;
    api.appInfo().then(
      (loaded) => current && setInfo(loaded),
      (failure) => current && onError(describeError(failure)),
    );
    return () => {
      current = false;
    };
  }, [api, onError]);

  return info;
}
