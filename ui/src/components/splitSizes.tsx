import { type ReactNode, createContext, useContext, useRef, useState } from "react";

const SplitSizesContext = createContext<Map<string, number> | null>(null);

/** Remembers split sizes for the life of the app, so a view that unmounts gets its size back; nothing is persisted. */
export function SplitSizesProvider({ children }: { children: ReactNode }) {
  const sizes = useRef(new Map<string, number>());
  return <SplitSizesContext.Provider value={sizes.current}>{children}</SplitSizesContext.Provider>;
}

export function useSplitRatio(sizeKey: string | undefined, fallback: number) {
  const sizes = useContext(SplitSizesContext);
  const [ratio, setRatioState] = useState(() => (sizeKey ? sizes?.get(sizeKey) : undefined) ?? fallback);

  function setRatio(next: number) {
    setRatioState(next);
    if (sizeKey) sizes?.set(sizeKey, next);
  }

  return [ratio, setRatio] as const;
}
