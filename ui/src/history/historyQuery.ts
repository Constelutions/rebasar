/**
 * Reads and edits the terms of the History filter query as text, so the Branches and Authors
 * selects and the typed query stay one thing. The syntax is the core's (`crates/rebasar-core/src/query.rs`):
 * whitespace-separated terms, `key:value`, and a double-quoted value when it has spaces.
 */

/** The `author:` value the core resolves to the email in the Repository's Git configuration. */
export const MY_COMMITS = "@me";

interface Token {
  start: number;
  end: number;
  key: string | null;
  value: string;
}

function tokenize(query: string): Token[] {
  const tokens: Token[] = [];
  let position = 0;
  while (position < query.length) {
    if (/\s/.test(query[position]!)) {
      position += 1;
      continue;
    }
    const start = position;
    const keyed = /^([A-Za-z]+):/.exec(query.slice(position));
    const key = keyed ? keyed[1]!.toLowerCase() : null;
    if (keyed) position += keyed[0].length;

    let value = "";
    let quoted = false;
    for (; position < query.length; position += 1) {
      const char = query[position]!;
      if (!quoted && /\s/.test(char)) break;
      if (char === '"') quoted = !quoted;
      else if (quoted && char === ESCAPE && isEscapable(query[position + 1])) value += query[++position];
      else value += char;
    }
    tokens.push({ start, end: position, key, value });
  }
  return tokens;
}

export function termValues(query: string, key: string): string[] {
  return tokenize(query)
    .filter((token) => token.key === key)
    .map((token) => token.value);
}

const ESCAPE = String.fromCharCode(92);

function isEscapable(char: string | undefined): boolean {
  return char === '"' || char === ESCAPE;
}

function quote(value: string): string {
  const chars = [...value];
  if (value !== "" && !chars.some((char) => /\s/.test(char) || isEscapable(char))) return value;
  return `"${chars.map((char) => (isEscapable(char) ? ESCAPE + char : char)).join("")}"`;
}

export function addTerm(query: string, key: string, value: string): string {
  const typed = query.trimEnd();
  return `${typed}${typed === "" ? "" : " "}${key}:${quote(value)}`;
}

/** Removes the terms of `key` with that value (any case), or all of them when no value is given. */
export function removeTerm(query: string, key: string, value?: string): string {
  const wanted = value?.toLowerCase();
  const doomed = tokenize(query).filter(
    (token) => token.key === key && (wanted === undefined || token.value.toLowerCase() === wanted),
  );
  let result = query;
  for (const { start, end } of doomed.reverse()) {
    const after = /^\s*/.exec(result.slice(end))![0].length;
    result = `${result.slice(0, start)}${result.slice(end + after)}`;
  }
  return doomed.length === 0 ? query : result.trimEnd();
}
