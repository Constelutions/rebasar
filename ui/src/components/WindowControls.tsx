import type { AppWindow } from "../shell/appWindow";
import { Button } from "./Button";

export function WindowControls({ appWindow }: { appWindow: AppWindow }) {
  return (
    <div role="group" aria-label="Window controls" className="window-controls">
      <Button variant="plain" type="button" aria-label="Minimize" onClick={() => void appWindow.minimize()}>
        <svg viewBox="0 0 10 10" aria-hidden="true">
          <path d="M0 5h10" />
        </svg>
      </Button>
      <Button variant="plain" type="button" aria-label="Maximize" onClick={() => void appWindow.toggleMaximize()}>
        <svg viewBox="0 0 10 10" aria-hidden="true">
          <rect x="0.5" y="0.5" width="9" height="9" />
        </svg>
      </Button>
      <Button
        variant="plain"
        type="button"
        aria-label="Close"
        className="close"
        onClick={() => void appWindow.close()}
      >
        <svg viewBox="0 0 10 10" aria-hidden="true">
          <path d="M0 0l10 10M10 0L0 10" />
        </svg>
      </Button>
    </div>
  );
}
