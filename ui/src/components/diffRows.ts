import type { DiffLine, Hunk } from "../core/api";

export type DiffRow =
  | { type: "hunk"; key: string; hunk: Hunk; header: string }
  | { type: "line"; key: string; line: DiffLine }
  | { type: "pair"; key: string; left: DiffLine | null; right: DiffLine | null };

export function hunkHeader(hunk: Hunk) {
  return `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`;
}

export function unifiedRows(hunks: Hunk[]): DiffRow[] {
  return hunks.flatMap((hunk, hunkIndex) => [
    { type: "hunk" as const, key: `h${hunkIndex}`, hunk, header: hunkHeader(hunk) },
    ...hunk.lines.map((line, index) => ({
      type: "line" as const,
      key: `h${hunkIndex}:${index}`,
      line,
    })),
  ]);
}

/** Removed lines sit beside the added lines that replace them, line for line. */
export function sideBySideRows(hunks: Hunk[]): DiffRow[] {
  const rows: DiffRow[] = [];
  hunks.forEach((hunk, hunkIndex) => {
    rows.push({ type: "hunk", key: `h${hunkIndex}`, hunk, header: hunkHeader(hunk) });

    let removed: DiffLine[] = [];
    let added: DiffLine[] = [];
    const flush = () => {
      const count = Math.max(removed.length, added.length);
      for (let index = 0; index < count; index++) {
        rows.push({
          type: "pair",
          key: `h${hunkIndex}:c${rows.length}`,
          left: removed[index] ?? null,
          right: added[index] ?? null,
        });
      }
      removed = [];
      added = [];
    };

    for (const line of hunk.lines) {
      if (line.kind === "removed") removed.push(line);
      else if (line.kind === "added") added.push(line);
      else {
        flush();
        rows.push({ type: "pair", key: `h${hunkIndex}:c${rows.length}`, left: line, right: line });
      }
    }
    flush();
  });
  return rows;
}

export function isChanged(line: DiffLine) {
  return line.kind !== "context";
}

export function changedLines(hunk: Hunk): DiffLine[] {
  return hunk.lines.filter(isChanged);
}

/** Identifies a line across refreshes of the same diff. */
export function lineKey(line: DiffLine) {
  return `${line.kind}:${line.oldNumber}:${line.newNumber}`;
}
