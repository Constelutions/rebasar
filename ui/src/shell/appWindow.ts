/** The native window the UI lives in; the shell binds it to the real window, tests use a fake. */
export interface AppWindow {
  minimize(): Promise<void>;
  toggleMaximize(): Promise<void>;
  close(): Promise<void>;
}
