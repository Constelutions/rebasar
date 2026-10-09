import "@fontsource-variable/geist";
import "@fontsource-variable/jetbrains-mono";
import { open } from "@tauri-apps/plugin-dialog";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import { tauriCoreApi } from "./core/tauri";
import { tauriWindow } from "./shell/tauriWindow";
import "./styles.css";

async function pickFolder(): Promise<string | null> {
  const selected = await open({ directory: true, multiple: false });
  return typeof selected === "string" ? selected : null;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App api={tauriCoreApi} pickFolder={pickFolder} appWindow={tauriWindow} />
  </StrictMode>,
);
