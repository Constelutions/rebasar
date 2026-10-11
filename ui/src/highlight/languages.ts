const languageByExtension: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  cts: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  json: "json",
  rs: "rust",
  py: "python",
  cs: "csharp",
  css: "css",
  html: "xml",
  xml: "xml",
  svg: "xml",
  csproj: "xml",
  md: "markdown",
  sh: "bash",
  bash: "bash",
  yml: "yaml",
  yaml: "yaml",
  toml: "ini",
  ini: "ini",
  go: "go",
  java: "java",
  c: "c",
  h: "c",
  cpp: "cpp",
  hpp: "cpp",
  sql: "sql",
};

/** The highlight.js language for a file, or `null` when it is shown as plain text. */
export function languageFor(path: string): string | null {
  const fileName = path.slice(path.lastIndexOf("/") + 1);
  const dot = fileName.lastIndexOf(".");
  if (dot < 0) return null;
  return languageByExtension[fileName.slice(dot + 1).toLowerCase()] ?? null;
}
