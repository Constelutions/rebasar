import { useEffect, useId, useMemo, useState } from "react";

import type {
  ConflictFile,
  ConflictSegment,
  ConflictSide,
  CoreApi,
  MutationOutcome,
  WorktreeStatus,
} from "../core/api";
import { describeError } from "../core/describeError";

interface ConflictsViewProps {
  api: CoreApi;
  worktreePath: string;
  status: WorktreeStatus | null;
}

export function ConflictsView({ api, worktreePath, status }: ConflictsViewProps) {
  const [picked, setPicked] = useState<string | null>(null);
  const conflicts = status?.conflicts ?? [];
  const selected = conflicts.find((change) => change.path === picked) ?? conflicts[0];

  if (!status) return null;
  if (conflicts.length === 0) {
    return <p className="placeholder">No conflicts. Continue the operation from the banner.</p>;
  }

  return (
    <div className="conflicts">
      <ul className="conflict-files" aria-label="Conflicted files">
        {conflicts.map((change) => (
          <li key={change.path}>
            <button
              type="button"
              aria-pressed={change.path === selected?.path}
              onClick={() => setPicked(change.path)}
            >
              {change.path}
            </button>
          </li>
        ))}
      </ul>
      {selected && (
        <ConflictResolver
          key={selected.path}
          api={api}
          worktreePath={worktreePath}
          path={selected.path}
        />
      )}
    </div>
  );
}

function ConflictResolver({
  api,
  worktreePath,
  path,
}: {
  api: CoreApi;
  worktreePath: string;
  path: string;
}) {
  const [file, setFile] = useState<ConflictFile | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    api.conflictFile(worktreePath, path).then(
      (loaded) => current && setFile(loaded),
      (failure) => current && setError(describeError(failure)),
    );
    return () => {
      current = false;
    };
  }, [api, worktreePath, path]);

  async function run(title: string, action: () => Promise<MutationOutcome>) {
    setError(null);
    try {
      const outcome = await action();
      if (outcome.kind === "failed") setError(`${title} failed. Details are in the output panel.`);
    } catch (failure) {
      setError(describeError(failure));
    }
  }

  return (
    <section className="conflict-detail" aria-label={`Conflict in ${path}`}>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {file?.kind === "text" && (
        <TextResolver
          file={file}
          onResolve={(contents) =>
            run("Marking the file resolved", () =>
              api.resolveConflictFile(worktreePath, path, contents),
            )
          }
        />
      )}
      {(file?.kind === "binary" || file?.kind === "deleteModify") && (
        <SideChooser
          file={file}
          onChoose={(side) =>
            run("Resolving the file", () => api.resolveConflictWithSide(worktreePath, path, side))
          }
        />
      )}
      {file?.kind === "unsupported" && (
        <div className="conflict-unsupported">
          <p>
            This kind of conflict, such as a rename or a folder against a file, is not resolved
            here.
          </p>
          {file.mergeToolConfigured ? (
            <button
              type="button"
              onClick={() => void run("The merge tool", () => api.openMergeTool(worktreePath, path))}
            >
              Open merge tool
            </button>
          ) : (
            <p>
              Resolve in terminal: run <code>git mergetool</code>, or fix the file by hand and run{" "}
              <code>git add</code> on it.
            </p>
          )}
        </div>
      )}
    </section>
  );
}

type Choice = "ours" | "theirs" | "both";

function TextResolver({
  file,
  onResolve,
}: {
  file: ConflictFile;
  onResolve: (contents: string) => void;
}) {
  const resultId = useId();
  const hunkCount = file.segments.filter((segment) => segment.kind === "conflict").length;
  const [choices, setChoices] = useState<(Choice | null)[]>(() => Array(hunkCount).fill(null));
  const [edited, setEdited] = useState<string | null>(null);
  const built = useMemo(() => buildResult(file.segments, choices), [file.segments, choices]);
  const result = edited ?? built;
  const unresolved = /^(<{7}|>{7})( |\r?$)/m.test(result);

  function choose(hunk: number, choice: Choice) {
    setEdited(null);
    setChoices((current) => current.map((existing, index) => (index === hunk ? choice : existing)));
  }

  return (
    <>
      <div className="conflict-panes">
        <section aria-label="Ours" className="conflict-pane">
          <h2>Ours</h2>
          <pre>{file.ours}</pre>
        </section>
        <section aria-label="Theirs" className="conflict-pane">
          <h2>Theirs</h2>
          <pre>{file.theirs}</pre>
        </section>
        <section aria-label="Result" className="conflict-pane">
          <h2>
            <label htmlFor={resultId}>Result</label>
          </h2>
          <textarea
            id={resultId}
            value={result}
            spellCheck={false}
            onChange={(event) => setEdited(event.target.value)}
          />
        </section>
      </div>
      {hunkCount > 0 && (
        <ol className="conflict-hunks" aria-label="Conflict hunks">
          {Array.from({ length: hunkCount }, (_, hunk) => (
            <li key={hunk}>
              <span>Hunk {hunk + 1}</span>
              {(["ours", "theirs", "both"] as const).map((choice) => (
                <button
                  key={choice}
                  type="button"
                  aria-label={`Accept ${choice} for hunk ${hunk + 1}`}
                  aria-pressed={edited === null && choices[hunk] === choice}
                  onClick={() => choose(hunk, choice)}
                >
                  Accept {choice}
                </button>
              ))}
            </li>
          ))}
        </ol>
      )}
      <div className="conflict-actions">
        {unresolved && <span className="settings-hint">Conflict markers are still in the result.</span>}
        <button type="button" disabled={unresolved} onClick={() => onResolve(result)}>
          Mark resolved
        </button>
      </div>
    </>
  );
}

function SideChooser({
  file,
  onChoose,
}: {
  file: ConflictFile;
  onChoose: (side: ConflictSide) => void;
}) {
  const note =
    file.deletedBy === "ours"
      ? "Our side deleted this file and their side changed it."
      : file.deletedBy === "theirs"
        ? "Their side deleted this file and our side changed it."
        : "This is a binary file, so it cannot be merged line by line.";
  const label = (side: ConflictSide) =>
    file.deletedBy === side ? `Delete the file (${side})` : `Keep ${side}`;

  return (
    <div className="conflict-sides">
      <p>{note}</p>
      <button type="button" onClick={() => onChoose("ours")}>
        {label("ours")}
      </button>
      <button type="button" onClick={() => onChoose("theirs")}>
        {label("theirs")}
      </button>
    </div>
  );
}

function buildResult(segments: ConflictSegment[], choices: (Choice | null)[]): string {
  let hunk = 0;
  return segments
    .map((segment) => {
      if (segment.kind === "text") return segment.text;
      const choice = choices[hunk++];
      switch (choice) {
        case "ours":
          return segment.ours;
        case "theirs":
          return segment.theirs;
        case "both":
          return segment.ours + segment.theirs;
        default:
          return `<<<<<<< ours\n${segment.ours}=======\n${segment.theirs}>>>>>>> theirs\n`;
      }
    })
    .join("");
}
