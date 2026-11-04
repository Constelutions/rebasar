import { type KeyboardEvent, useEffect, useId, useRef } from "react";

import { issuesUrl } from "../about";
import type { CoreApi } from "../core/api";
import { describeError } from "../core/describeError";
import type { VersionInfo } from "../useAppInfo";
import { BrandLogo } from "./BrandLogo";
import { Button } from "./Button";

interface AboutDialogProps {
  api: CoreApi;
  info: VersionInfo | null;
  onClose: () => void;
  onError: (message: string) => void;
}

export function AboutDialog({ api, info, onClose, onError }: AboutDialogProps) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const opener = document.activeElement;
    closeRef.current?.focus();
    return () => {
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, []);

  function reportIssue() {
    api.openInBrowser(issuesUrl).catch((failure) => onError(describeError(failure)));
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === "Escape") onClose();
  }

  return (
    <div className="dialog-backdrop">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="dialog"
        onKeyDown={onKeyDown}
      >
        <BrandLogo wordmark />
        <h2 id={titleId}>About Rebasar</h2>
        <div className="dialog-body">
          <p>Version {info?.version ?? "…"}</p>
          {info && <p>Channel: {info.channel}</p>}
          <p>Licensed under the Apache License 2.0.</p>
        </div>
        <div className="dialog-actions">
          <Button type="button" onClick={reportIssue}>
            Report an issue
          </Button>
          <Button type="button" ref={closeRef} onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
