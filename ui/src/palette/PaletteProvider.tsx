import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { CoreApi } from "../core/api";
import { shortcuts, useShortcut } from "../shortcuts";
import { CommandPalette } from "./CommandPalette";
import { CommandRegistry, type PaletteCommand, type PaletteContext } from "./registry";

interface PaletteHandle {
  registry: CommandRegistry;
  isOpen: boolean;
  open: () => void;
}

const PaletteHandleContext = createContext<PaletteHandle | null>(null);

interface PaletteProviderProps {
  api: CoreApi;
  /** The state commands are filtered by and run against. */
  context: PaletteContext;
  /** Shows the commits matching the History filter `query`. */
  onShowCommits: (query: string) => void;
  /** Called when a command rejects or throws. */
  onError: (failure: unknown) => void;
  children: ReactNode;
}

/** Owns the command registry and the palette, which Ctrl+P opens. */
export function PaletteProvider({
  api,
  context,
  onShowCommits,
  onError,
  children,
}: PaletteProviderProps) {
  const [registry] = useState(() => new CommandRegistry());
  const [isOpen, setIsOpen] = useState(false);
  const focusBeforeOpening = useRef<Element | null>(null);

  const open = useCallback(() => {
    focusBeforeOpening.current = document.activeElement;
    setIsOpen(true);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
    if (focusBeforeOpening.current instanceof HTMLElement) focusBeforeOpening.current.focus();
  }, []);

  useShortcut(shortcuts.commandPalette, () => (isOpen ? close() : open()));

  const handle = useMemo(() => ({ registry, isOpen, open }), [registry, isOpen, open]);

  return (
    <PaletteHandleContext value={handle}>
      {children}
      {isOpen && (
        <CommandPalette
          api={api}
          registry={registry}
          context={context}
          onClose={close}
          onShowCommits={onShowCommits}
          onError={onError}
        />
      )}
    </PaletteHandleContext>
  );
}

export function usePalette(): PaletteHandle {
  const handle = useContext(PaletteHandleContext);
  if (handle === null) throw new Error("usePalette needs a PaletteProvider above it");
  return handle;
}

/**
 * Lists `commands` in the palette for as long as the calling component is mounted. Declare the
 * array at module level, or memoise it, so the commands are not registered again on every render.
 */
export function usePaletteCommands(commands: readonly PaletteCommand[]) {
  const { registry } = usePalette();
  useEffect(() => registry.register(commands), [registry, commands]);
}
