import { useMemo } from "react";

import type { DiffLine, FileDiff, Hunk } from "../core/api";
import { useSyntaxTokens } from "../highlight/useSyntaxTokens";
import type { Token } from "../highlight/tokens";
import { type DiffMode, type DiffRow, sideBySideRows, unifiedRows } from "./diffRows";
import { VirtualList } from "./VirtualList";

export const DIFF_ROW_HEIGHT = 20;

interface DiffViewProps {
  diff: FileDiff;
  mode: DiffMode;
  onModeChange: (mode: DiffMode) => void;
  onLoadLarge: () => void;
}

export function DiffView({ diff, mode, onModeChange, onLoadLarge }: DiffViewProps) {
  const { content } = diff;
  return (
    <section className="diff-view" aria-label={`Diff of ${diff.path}`}>
      <header className="diff-header">
        <div className="diff-title">
          <span className="diff-path">{diff.path}</span>
          {diff.originalPath && <span className="renamed-from">renamed from {diff.originalPath}</span>}
          {diff.modeChange && (
            <span className="mode-change">
              mode {diff.modeChange.old} → {diff.modeChange.new}
            </span>
          )}
        </div>
        {content.kind === "text" && content.hunks.length > 0 && (
          <ModeToggle mode={mode} onChange={onModeChange} />
        )}
      </header>
      {content.kind === "text" &&
        (content.hunks.length > 0 ? (
          <TextDiff path={diff.path} hunks={content.hunks} mode={mode} />
        ) : (
          <p className="placeholder diff-note">No content changes.</p>
        ))}
      {content.kind === "binary" && (
        <p className="placeholder diff-note">
          Binary file. {describeSizes(content.oldBytes, content.newBytes)}
        </p>
      )}
      {content.kind === "collapsed" && (
        <div className="diff-note diff-collapsed">
          <p>
            This file is large ({formatBytes(content.bytes)}
            {content.lines !== null && `, ${content.lines.toLocaleString("en-US")} lines`}), so its
            diff is not shown.
          </p>
          <button type="button" className="button" onClick={onLoadLarge}>
            Load diff
          </button>
        </div>
      )}
    </section>
  );
}

function ModeToggle({ mode, onChange }: { mode: DiffMode; onChange: (mode: DiffMode) => void }) {
  const options: { mode: DiffMode; label: string }[] = [
    { mode: "unified", label: "Unified" },
    { mode: "sideBySide", label: "Side by side" },
  ];
  return (
    <div role="group" aria-label="Diff mode" className="mode-toggle">
      {options.map((option) => (
        <button
          key={option.mode}
          type="button"
          aria-pressed={mode === option.mode}
          onClick={() => onChange(option.mode)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function TextDiff({ path, hunks, mode }: { path: string; hunks: Hunk[]; mode: DiffMode }) {
  const tokens = useSyntaxTokens(path, hunks);
  const rows = useMemo(
    () => (mode === "unified" ? unifiedRows(hunks) : sideBySideRows(hunks)),
    [hunks, mode],
  );

  return (
    <VirtualList
      label="Changed lines"
      className={`diff-lines diff-${mode}`}
      items={rows}
      rowHeight={DIFF_ROW_HEIGHT}
      getKey={(row) => row.key}
      renderRow={(row) => <DiffRowView row={row} tokens={tokens} />}
    />
  );
}

function DiffRowView({ row, tokens }: { row: DiffRow; tokens: ReadonlyMap<DiffLine, Token[]> }) {
  if (row.type === "hunk") {
    return <div className="diff-hunk-header">{row.header}</div>;
  }
  if (row.type === "line") {
    return (
      <div className={`diff-line diff-${row.line.kind}`}>
        <span className="diff-number">{row.line.oldNumber}</span>
        <span className="diff-number">{row.line.newNumber}</span>
        <span className="diff-sign">{signOf(row.line)}</span>
        <LineText line={row.line} tokens={tokens} />
      </div>
    );
  }
  return (
    <div className="diff-pair">
      <Half line={row.left} number="oldNumber" tokens={tokens} />
      <Half line={row.right} number="newNumber" tokens={tokens} />
    </div>
  );
}

interface HalfProps {
  line: DiffLine | null;
  number: "oldNumber" | "newNumber";
  tokens: ReadonlyMap<DiffLine, Token[]>;
}

function Half({ line, number, tokens }: HalfProps) {
  if (!line) return <div className="diff-line diff-empty" />;
  return (
    <div className={`diff-line diff-${line.kind}`}>
      <span className="diff-number">{line[number]}</span>
      <span className="diff-sign">{signOf(line)}</span>
      <LineText line={line} tokens={tokens} />
    </div>
  );
}

function LineText({ line, tokens }: { line: DiffLine; tokens: ReadonlyMap<DiffLine, Token[]> }) {
  const lineTokens = tokens.get(line);
  return (
    <span className="diff-text">
      {lineTokens
        ? lineTokens.map((token, index) => (
            <span key={index} className={token.kind ? `token-${token.kind}` : undefined}>
              {token.text}
            </span>
          ))
        : line.text}
    </span>
  );
}

function signOf(line: DiffLine) {
  if (line.kind === "added") return "+";
  return line.kind === "removed" ? "−" : " ";
}

function describeSizes(oldBytes: number | null, newBytes: number | null) {
  const parts = [];
  if (oldBytes !== null) parts.push(`Before: ${formatBytes(oldBytes)}`);
  if (newBytes !== null) parts.push(`After: ${formatBytes(newBytes)}`);
  return parts.join(" · ");
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
