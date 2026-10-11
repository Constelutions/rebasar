import {
  type KeyboardEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import type { CommitHit, CoreApi } from "../core/api";
import { describeError } from "../core/describeError";
import { useDebounced } from "../useDebounced";
import { fuzzyScore } from "./fuzzy";
import type { CommandRegistry, PaletteCommand, PaletteContext } from "./registry";

const COMMIT_LIMIT = 8;
/** Typing is searched once it pauses, so each keystroke does not walk the history. */
const SEARCH_DEBOUNCE_MS = 150;
/** A match on a keyword is worth less than one on the title. */
const KEYWORD_PENALTY = 5;

type Entry =
  | { kind: "command"; command: PaletteCommand }
  | { kind: "commit"; hit: CommitHit }
  | { kind: "search"; text: string };

interface CommandPaletteProps {
  api: CoreApi;
  registry: CommandRegistry;
  context: PaletteContext;
  onClose: () => void;
  onShowCommits: (query: string) => void;
  onError: (failure: unknown) => void;
}

export function CommandPalette({
  api,
  registry,
  context,
  onClose,
  onShowCommits,
  onError,
}: CommandPaletteProps) {
  const registered = useSyncExternalStore(registry.subscribe, registry.getSnapshot);
  const [text, setText] = useState("");
  const [selected, setSelected] = useState(0);
  const listId = useId();
  const list = useRef<HTMLUListElement>(null);

  const needle = text.trim();
  const commands = useMemo(
    () => rankCommands(registered.filter((command) => command.when?.(context) ?? true), needle),
    [registered, context, needle],
  );
  const search = useCommitSearch(api, context.activeTab?.tab.worktreePath, needle);

  const entries: Entry[] = [
    ...commands.map((command): Entry => ({ kind: "command", command })),
    ...search.hits.map((hit): Entry => ({ kind: "commit", hit })),
    ...(search.available && needle !== "" ? [{ kind: "search", text: needle } as const] : []),
  ];
  const active = Math.min(selected, entries.length - 1);

  useEffect(() => {
    list.current?.children[active]?.scrollIntoView?.({ block: "nearest" });
  }, [active]);

  async function choose(entry: Entry) {
    onClose();
    try {
      switch (entry.kind) {
        case "command":
          await entry.command.run(context);
          break;
        case "commit":
          onShowCommits(quoted(entry.hit.subject));
          break;
        case "search":
          onShowCommits(entry.text);
          break;
      }
    } catch (failure) {
      onError(failure);
    }
  }

  function onKeyDown(event: KeyboardEvent) {
    switch (event.key) {
      case "ArrowDown":
        setSelected((active + 1) % Math.max(entries.length, 1));
        break;
      case "ArrowUp":
        setSelected((active - 1 + entries.length) % Math.max(entries.length, 1));
        break;
      case "Enter": {
        const entry = entries[active];
        if (entry) void choose(entry);
        break;
      }
      case "Escape":
        onClose();
        break;
      case "Tab":
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  return (
    <div
      className="palette-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div role="dialog" aria-modal="true" aria-label="Command palette" className="palette">
        <input
          type="text"
          role="combobox"
          aria-label="Search or run"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={entries.length > 0 ? `${listId}-${active}` : undefined}
          aria-autocomplete="list"
          autoFocus
          autoComplete="off"
          spellCheck={false}
          placeholder="Search or run…"
          className="palette-input"
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setSelected(0);
          }}
          onKeyDown={onKeyDown}
        />
        <ul ref={list} id={listId} role="listbox" aria-label="Results" className="palette-list">
          {entries.map((entry, index) => (
            <li
              key={entryKey(entry)}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === active}
              className="palette-option"
              onMouseMove={() => setSelected(index)}
              onClick={() => void choose(entry)}
            >
              <EntryRow entry={entry} />
            </li>
          ))}
        </ul>
        {search.error !== null && (
          <p role="alert" className="palette-message palette-error">
            {search.error}
          </p>
        )}
        {entries.length === 0 && search.error === null && (
          <p className="palette-message">
            {context.activeTab ? "Nothing matches." : "Nothing matches. Open a folder to search its commits."}
          </p>
        )}
      </div>
    </div>
  );
}

function EntryRow({ entry }: { entry: Entry }) {
  switch (entry.kind) {
    case "command":
      return (
        <>
          <span className="palette-group">{entry.command.group}</span>
          <span className="palette-title">{entry.command.title}</span>
          {entry.command.shortcut && <kbd className="palette-shortcut">{entry.command.shortcut}</kbd>}
        </>
      );
    case "commit":
      return (
        <>
          <span className="palette-group">Commit</span>
          <span className="palette-hash">{entry.hit.shortId}</span>
          <span className="palette-title">{entry.hit.subject}</span>
          <span className="palette-detail">{entry.hit.authorName}</span>
        </>
      );
    case "search":
      return (
        <>
          <span className="palette-group">Commits</span>
          <span className="palette-title">Search commits for “{entry.text}”</span>
        </>
      );
  }
}

function entryKey(entry: Entry): string {
  switch (entry.kind) {
    case "command":
      return `command:${entry.command.id}`;
    case "commit":
      return `commit:${entry.hit.id}`;
    case "search":
      return "search";
  }
}

function rankCommands(commands: PaletteCommand[], needle: string): PaletteCommand[] {
  if (needle === "") return commands;

  const scored: { command: PaletteCommand; score: number }[] = [];
  for (const command of commands) {
    const best = Math.max(
      fuzzyScore(needle, command.title) ?? -Infinity,
      (fuzzyScore(needle, `${command.group} ${command.title}`) ?? -Infinity) - 1,
      (fuzzyScore(needle, (command.keywords ?? []).join(" ")) ?? -Infinity) - KEYWORD_PENALTY,
    );
    if (best > -Infinity) scored.push({ command, score: best });
  }
  return scored.sort((a, b) => b.score - a.score).map(({ command }) => command);
}

interface CommitSearch {
  /** Whether there is a Tab whose commits can be searched. */
  available: boolean;
  hits: CommitHit[];
  /** Why the core refused the text as a query. */
  error: string | null;
}

/** Looks the text up as a commit search once typing pauses; text no command takes is one. */
function useCommitSearch(api: CoreApi, worktreePath: string | undefined, text: string): CommitSearch {
  const settled = useDebounced(text, SEARCH_DEBOUNCE_MS);
  const [result, setResult] = useState<{
    worktreePath: string;
    text: string;
    hits: CommitHit[];
    error: string | null;
  } | null>(null);

  useEffect(() => {
    if (worktreePath === undefined || settled === "") return;
    let current = true;
    api.findCommits(worktreePath, settled, COMMIT_LIMIT).then(
      (hits) => current && setResult({ worktreePath, text: settled, hits, error: null }),
      (failure) =>
        current &&
        setResult({ worktreePath, text: settled, hits: [], error: describeError(failure) }),
    );
    return () => {
      current = false;
    };
  }, [api, worktreePath, settled]);

  const fresh =
    result !== null &&
    result.worktreePath === worktreePath &&
    result.text === text &&
    text !== "";
  return {
    available: worktreePath !== undefined,
    hits: fresh ? result.hits : [],
    error: fresh ? result.error : null,
  };
}

/** The text as one History filter term, whatever it contains. */
function quoted(text: string): string {
  return `"${text.replace(/[\\"]/g, "\\$&")}"`;
}
