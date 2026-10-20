import { useMemo, useState } from "react";

import type { DiffLine, DiffMode, FileDiff, Hunk } from "../core/api";
import { useSyntaxTokens } from "../highlight/useSyntaxTokens";
import type { Token } from "../highlight/tokens";
import { Button } from "./Button";
import {
  type DiffRow,
  changedLines,
  isChanged,
  lineKey,
  sideBySideRows,
  unifiedRows,
} from "./diffRows";
import { VirtualList } from "./VirtualList";

export const DIFF_ROW_HEIGHT = 20;

/** What picking hunks and lines in the diff does: stage them, or unstage them. */
export interface LineStaging {
  label: "Stage" | "Unstage";
  apply: (lines: DiffLine[]) => void;
}

interface DiffViewProps {
  diff: FileDiff;
  mode: DiffMode;
  onModeChange: (mode: DiffMode) => void;
  onLoadLarge: () => void;
  staging?: LineStaging;
}

export function DiffView({ diff, mode, onModeChange, onLoadLarge, staging }: DiffViewProps) {
  const { content } = diff;
  const [pickedKeys, setPickedKeys] = useState<ReadonlySet<string>>(new Set());
  const picked = useMemo(
    () =>
      content.kind === "text"
        ? content.hunks.flatMap(changedLines).filter((line) => pickedKeys.has(lineKey(line)))
        : [],
    [content, pickedKeys],
  );

  function togglePick(line: DiffLine) {
    setPickedKeys((current) => {
      const next = new Set(current);
      if (!next.delete(lineKey(line))) next.add(lineKey(line));
      return next;
    });
  }

  const applying: LineStaging | undefined = staging && {
    label: staging.label,
    apply: (lines) => {
      setPickedKeys(new Set());
      staging.apply(lines);
    },
  };

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
          <div className="diff-controls">
            {applying && (
              <Button
                type="button"
                disabled={picked.length === 0}
                onClick={() => applying.apply(picked)}
              >
                {applying.label} selected lines
              </Button>
            )}
            <ModeToggle mode={mode} onChange={onModeChange} />
          </div>
        )}
      </header>
      {content.kind === "text" &&
        (content.hunks.length > 0 ? (
          <TextDiff
            path={diff.path}
            hunks={content.hunks}
            mode={mode}
            staging={applying}
            picked={pickedKeys}
            onTogglePick={togglePick}
          />
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
          <Button type="button" onClick={onLoadLarge}>
            Load diff
          </Button>
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
        <Button
          variant="plain"
          key={option.mode}
          type="button"
          aria-pressed={mode === option.mode}
          onClick={() => onChange(option.mode)}
        >
          {option.label}
        </Button>
      ))}
    </div>
  );
}

interface RowContext {
  tokens: ReadonlyMap<DiffLine, Token[]>;
  staging: LineStaging | undefined;
  picked: ReadonlySet<string>;
  onTogglePick: (line: DiffLine) => void;
}

interface TextDiffProps extends Omit<RowContext, "tokens"> {
  path: string;
  hunks: Hunk[];
  mode: DiffMode;
}

function TextDiff({ path, hunks, mode, staging, picked, onTogglePick }: TextDiffProps) {
  const tokens = useSyntaxTokens(path, hunks);
  const rows = useMemo(
    () => (mode === "unified" ? unifiedRows(hunks) : sideBySideRows(hunks)),
    [hunks, mode],
  );
  const context: RowContext = { tokens, staging, picked, onTogglePick };

  return (
    <VirtualList
      label="Changed lines"
      className={`diff-lines diff-${mode}`}
      items={rows}
      rowHeight={DIFF_ROW_HEIGHT}
      getKey={(row) => row.key}
      renderRow={(row) => <DiffRowView row={row} {...context} />}
    />
  );
}

function DiffRowView({ row, ...context }: { row: DiffRow } & RowContext) {
  const { staging } = context;
  if (row.type === "hunk") {
    return (
      <div className="diff-hunk-header">
        <span>{row.header}</span>
        {staging && (
          <Button
            variant="plain"
            type="button"
            className="hunk-action"
            aria-label={`${staging.label} hunk ${row.header}`}
            onClick={() => staging.apply(changedLines(row.hunk))}
          >
            {staging.label} hunk
          </Button>
        )}
      </div>
    );
  }
  if (row.type === "line") {
    return (
      <div className={`diff-line diff-${row.line.kind}`}>
        <LinePick line={row.line} {...context} />
        <span className="diff-number">{row.line.oldNumber}</span>
        <span className="diff-number">{row.line.newNumber}</span>
        <span className="diff-sign">{signOf(row.line)}</span>
        <LineText line={row.line} tokens={context.tokens} />
      </div>
    );
  }
  return (
    <div className="diff-pair">
      <Half line={row.left} number="oldNumber" {...context} />
      <Half line={row.right} number="newNumber" {...context} />
    </div>
  );
}

function Half({
  line,
  number,
  ...context
}: { line: DiffLine | null; number: "oldNumber" | "newNumber" } & RowContext) {
  if (!line) return <div className="diff-line diff-empty" />;
  return (
    <div className={`diff-line diff-${line.kind}`}>
      <LinePick line={line} {...context} />
      <span className="diff-number">{line[number]}</span>
      <span className="diff-sign">{signOf(line)}</span>
      <LineText line={line} tokens={context.tokens} />
    </div>
  );
}

function LinePick({ line, staging, picked, onTogglePick }: { line: DiffLine } & RowContext) {
  if (!staging || !isChanged(line)) return <span className="diff-pick" />;
  const number = line.kind === "added" ? line.newNumber : line.oldNumber;
  return (
    <span className="diff-pick">
      <input
        type="checkbox"
        aria-label={`Select ${line.kind} line ${number}`}
        checked={picked.has(lineKey(line))}
        onChange={() => onTogglePick(line)}
      />
    </span>
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
