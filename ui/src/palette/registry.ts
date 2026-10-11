import type { OpenTab } from "../useOpenTabs";
import type { ViewName } from "../views";

/** What a command may look at to decide whether it applies, and to act on. */
export interface PaletteContext {
  /** The Tab in front, if any is open. */
  activeTab: OpenTab | undefined;
  view: ViewName;
}

export interface PaletteCommand {
  /** Unique and stable, namespaced by feature: `history.toggle-mine`. */
  id: string;
  /** What the palette lists and fuzzy-matches; an imperative phrase: "Show only my commits". */
  title: string;
  /** Names the feature the command belongs to and heads its row: "History", "Window". */
  group: string;
  /** Extra words the title should also be found by. */
  keywords?: readonly string[];
  /** Display only; bind the key with `useShortcut`. */
  shortcut?: string;
  /** Hides the command when it does not apply to the Tab's state; absent means always. */
  when?: (context: PaletteContext) => boolean;
  run: (context: PaletteContext) => void | Promise<void>;
}

export class CommandRegistry {
  private readonly commands = new Map<string, PaletteCommand>();
  private readonly listeners = new Set<() => void>();
  private snapshot: readonly PaletteCommand[] = [];

  /** Returns the function that withdraws the commands again. */
  register(commands: readonly PaletteCommand[]): () => void {
    for (const command of commands) {
      if (this.commands.has(command.id)) {
        throw new Error(`The palette command "${command.id}" is already registered`);
      }
    }
    for (const command of commands) this.commands.set(command.id, command);
    this.changed();

    return () => {
      for (const command of commands) {
        if (this.commands.get(command.id) === command) this.commands.delete(command.id);
      }
      this.changed();
    };
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** The same array until the registrations change, as `useSyncExternalStore` requires. */
  getSnapshot = (): readonly PaletteCommand[] => this.snapshot;

  private changed() {
    this.snapshot = [...this.commands.values()];
    this.listeners.forEach((listener) => listener());
  }
}
