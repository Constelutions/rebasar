import { getCurrentWindow } from "@tauri-apps/api/window";

import type { AppWindow } from "./appWindow";

export const tauriWindow: AppWindow = {
  minimize: () => getCurrentWindow().minimize(),
  toggleMaximize: () => getCurrentWindow().toggleMaximize(),
  close: () => getCurrentWindow().close(),
};
