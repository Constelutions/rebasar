import { useEffect, useState } from "react";

import type { DiffLine, Hunk } from "../core/api";
import { useHighlighter } from "./highlighter";
import { languageFor } from "./languages";
import type { Token } from "./tokens";

const NO_TOKENS: ReadonlyMap<DiffLine, Token[]> = new Map();

/**
 * Tokens for each line of the diff, empty until the worker answers. The two sides of the diff are
 * highlighted as separate documents, so a line is read in the context of the file it is from.
 */
export function useSyntaxTokens(path: string, hunks: Hunk[]): ReadonlyMap<DiffLine, Token[]> {
  const highlighter = useHighlighter();
  const [result, setResult] = useState<{
    hunks: Hunk[];
    tokens: ReadonlyMap<DiffLine, Token[]>;
  } | null>(null);

  useEffect(() => {
    const language = languageFor(path);
    if (!language) return;

    let current = true;
    const lines = hunks.flatMap((hunk) => hunk.lines);
    const oldSide = lines.filter((line) => line.kind !== "added");
    const newSide = lines.filter((line) => line.kind !== "removed");
    Promise.all([
      highlighter.highlight(language, oldSide.map((line) => line.text)),
      highlighter.highlight(language, newSide.map((line) => line.text)),
    ])
      .then(([oldTokens, newTokens]) => {
        if (!current) return;
        const tokens = new Map<DiffLine, Token[]>();
        for (const [side, sideTokens] of [
          [oldSide, oldTokens],
          [newSide, newTokens],
        ] as const) {
          side.forEach((line, index) => {
            const lineTokens = sideTokens[index];
            if (lineTokens) tokens.set(line, lineTokens);
          });
        }
        setResult({ hunks, tokens });
      })
      .catch(() => {
        // Plain text is a complete rendering; highlighting is only an enhancement.
      });
    return () => {
      current = false;
    };
  }, [highlighter, path, hunks]);

  return result?.hunks === hunks ? result.tokens : NO_TOKENS;
}
