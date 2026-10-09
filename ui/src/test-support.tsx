import { render } from "@testing-library/react";

import { App } from "./App";
import type { CoreApi } from "./core/api";
import { createStubCoreApi } from "./core/stub";
import type { AppWindow } from "./shell/appWindow";

export function createFakeWindow() {
  return {
    minimize: vi.fn(async () => {}),
    toggleMaximize: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
  } satisfies AppWindow;
}

interface RenderAppOptions {
  api?: CoreApi;
  pickFolder?: () => Promise<string | null>;
  appWindow?: AppWindow;
}

export function renderApp({
  api = createStubCoreApi(),
  pickFolder = async () => null,
  appWindow = createFakeWindow(),
}: RenderAppOptions = {}) {
  return render(<App api={api} pickFolder={pickFolder} appWindow={appWindow} />);
}
