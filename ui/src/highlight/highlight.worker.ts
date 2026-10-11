import { highlightLines } from "./highlightLines";
import type { Token } from "./tokens";

export interface HighlightRequest {
  id: number;
  language: string;
  lines: string[];
}

export interface HighlightResponse {
  id: number;
  tokens: Token[][];
}

// The DOM typings are in use project-wide, which type `self` as a Window.
const scope = self as unknown as {
  onmessage: (event: MessageEvent<HighlightRequest>) => void;
  postMessage: (message: HighlightResponse) => void;
};

scope.onmessage = ({ data }) => {
  scope.postMessage({ id: data.id, tokens: highlightLines(data.language, data.lines) });
};
