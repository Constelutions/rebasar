import { useEffect, useId, useRef, useState } from "react";

import { type MutationRun, type MutationState, isActive } from "../useMutations";
import { Button } from "./Button";

interface OutputPanelProps {
  runs: MutationRun[];
  onCancel: (run: MutationRun) => void;
}

export function OutputPanel({ runs, onCancel }: OutputPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const bodyId = useId();
  const active = runs.find(isActive);
  const latest = runs.at(-1);

  const failures = runs.filter((run) => run.state.kind === "failed").length;
  const seenFailures = useRef(failures);
  useEffect(() => {
    if (failures > seenFailures.current) setExpanded(true);
    seenFailures.current = failures;
  }, [failures]);

  return (
    <section aria-label="Output" className="output-panel">
      <header className="output-header">
        <Button
          variant="plain"
          type="button"
          aria-expanded={expanded}
          aria-controls={bodyId}
          className="output-toggle"
          onClick={() => setExpanded((current) => !current)}
        >
          Output
        </Button>
        <span role="status" className="output-summary">
          {summarise(active, latest)}
        </span>
        {active && (
          <>
            <progress aria-label={`${active.title} in progress`} className="output-progress" />
            <Button type="button" className="output-cancel" onClick={() => onCancel(active)}>
              Cancel {active.title}
            </Button>
          </>
        )}
      </header>
      {expanded && (
        <div id={bodyId} className="output-body">
          {runs.length === 0 && <p className="placeholder">No output yet.</p>}
          {runs.map((run) => (
            <article key={run.id} aria-label={run.title} className="output-run">
              <h3>
                {run.title} <span className="output-state">{describeState(run.state)}</span>
              </h3>
              <pre className="output-lines">
                {run.lines.map((line, index) => (
                  <span key={index} className={`output-line output-${line.stream}`}>
                    {line.text}
                    {"\n"}
                  </span>
                ))}
              </pre>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function summarise(active: MutationRun | undefined, latest: MutationRun | undefined): string {
  if (active) {
    return `${active.state.kind === "queued" ? "Waiting" : "Running"}: ${active.title}`;
  }
  if (latest) return `${latest.title}: ${describeState(latest.state)}`;
  return "No activity";
}

function describeState(state: MutationState): string {
  switch (state.kind) {
    case "queued":
      return "waiting";
    case "running":
      return "running";
    case "succeeded":
      return "succeeded";
    case "failed":
      return state.exitCode === null ? "failed" : `failed (exit code ${state.exitCode})`;
    case "cancelled":
      return "cancelled";
  }
}
