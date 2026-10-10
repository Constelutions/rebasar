import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import go from "highlight.js/lib/languages/go";
import ini from "highlight.js/lib/languages/ini";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

import { type Token, tokensByLine } from "./tokens";

const languages = {
  bash,
  c,
  cpp,
  csharp,
  css,
  go,
  ini,
  java,
  javascript,
  json,
  markdown,
  python,
  rust,
  sql,
  typescript,
  xml,
  yaml,
};
for (const [name, definition] of Object.entries(languages)) {
  hljs.registerLanguage(name, definition);
}

/** One token list per input line; a language that is not registered gives plain text. */
export function highlightLines(language: string, lines: string[]): Token[][] {
  if (!hljs.getLanguage(language)) return lines.map((text) => [{ text, kind: null }]);
  const html = hljs.highlight(lines.join("\n"), { language, ignoreIllegals: true }).value;
  return tokensByLine(html);
}
