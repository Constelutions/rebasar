import { createContext, useContext } from "react";

import type { HighlightRequest, HighlightResponse } from "./highlight.worker";
import type { Token } from "./tokens";

export interface Highlighter {
  /** Resolves to one token list per line. */
  highlight(language: string, lines: string[]): Promise<Token[][]>;
}

/** Highlights in a Web Worker so scrolling and typing never wait on a tokenizer. */
export function createWorkerHighlighter(): Highlighter {
  let worker: Worker | null = null;
  let nextId = 0;
  const pending = new Map<number, (tokens: Token[][]) => void>();

  function start() {
    const created = new Worker(new URL("./highlight.worker.ts", import.meta.url), {
      type: "module",
    });
    created.onmessage = ({ data }: MessageEvent<HighlightResponse>) => {
      pending.get(data.id)?.(data.tokens);
      pending.delete(data.id);
    };
    return created;
  }

  return {
    highlight(language, lines) {
      if (typeof Worker === "undefined") {
        return Promise.reject(new Error("Web Workers are not available"));
      }
      worker ??= start();
      const id = nextId++;
      const request: HighlightRequest = { id, language, lines };
      return new Promise((resolve) => {
        pending.set(id, resolve);
        worker?.postMessage(request);
      });
    },
  };
}

export const defaultHighlighter = createWorkerHighlighter();

const HighlighterContext = createContext<Highlighter>(defaultHighlighter);

export const HighlighterProvider = HighlighterContext.Provider;

export function useHighlighter() {
  return useContext(HighlighterContext);
}
