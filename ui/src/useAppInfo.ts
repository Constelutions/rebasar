import { useEffect, useState } from "react";

import { type Channel, channelOf } from "./channel";
import type { CoreApi } from "./core/api";
import { describeError } from "./core/describeError";

export interface VersionInfo {
  version: string;
  channel: Channel;
}

/** Null until the version has been read. */
export function useAppInfo(api: CoreApi, onError: (message: string) => void): VersionInfo | null {
  const [info, setInfo] = useState<VersionInfo | null>(null);

  useEffect(() => {
    let current = true;
    api.appInfo().then(
      ({ version }) => current && setInfo({ version, channel: channelOf(version) }),
      (failure) => current && onError(describeError(failure)),
    );
    return () => {
      current = false;
    };
  }, [api, onError]);

  return info;
}
