export type TokenKind = "keyword" | "string" | "comment" | "number" | "title" | "attribute";

export interface Token {
  text: string;
  kind: TokenKind | null;
}

const kindByScope = new Map<string, TokenKind>(Object.entries({
  keyword: "keyword",
  built_in: "keyword",
  literal: "keyword",
  type: "keyword",
  selector: "keyword",
  string: "string",
  regexp: "string",
  symbol: "string",
  subst: "string",
  comment: "comment",
  doctag: "comment",
  quote: "comment",
  number: "number",
  title: "title",
  section: "title",
  name: "title",
  attr: "attribute",
  attribute: "attribute",
  property: "attribute",
  variable: "attribute",
  params: "attribute",
} as const));

const entities = new Map(Object.entries({
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#x27;": "'",
}));

const markup = /<span class="([^"]*)">|<\/span>|&(?:amp|lt|gt|quot|#x27);|\n|[^<&\n]+/g;

function kindOf(classes: string): TokenKind | null {
  for (const name of classes.split(/\s+/)) {
    if (!name.startsWith("hljs-")) continue;
    const kind = kindByScope.get(name.slice("hljs-".length));
    if (kind) return kind;
  }
  return null;
}

/** Turns highlight.js's HTML into one list of tokens per line, so no markup reaches the page. */
export function tokensByLine(html: string): Token[][] {
  let line: Token[] = [];
  const lines: Token[][] = [line];
  const open: (TokenKind | null)[] = [];

  for (const [piece, classes] of html.matchAll(markup)) {
    if (piece === "\n") {
      line = [];
      lines.push(line);
    } else if (piece.startsWith("<span")) {
      open.push(kindOf(classes ?? ""));
    } else if (piece === "</span>") {
      open.pop();
    } else {
      const kind = open.reduce<TokenKind | null>((inner, candidate) => candidate ?? inner, null);
      const text = entities.get(piece) ?? piece;
      const previous = line.at(-1);
      if (previous && previous.kind === kind) previous.text += text;
      else line.push({ text, kind });
    }
  }
  return lines;
}
