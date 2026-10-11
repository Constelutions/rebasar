import { useEffect, useState } from "react";

import type { CoreApi, CoreEvent, OutputStream } from "./core/api";

export interface OutputLine {
  stream: OutputStream;
  text: string;
  /** A progress update; the next line replaces it. */
  transient: boolean;
}

export type MutationState =
  | { kind: "queued" }
  | { kind: "running" }
  | { kind: "succeeded" }
  | { kind: "failed"; exitCode: number | null }
  | { kind: "cancelled" };

export interface MutationRun {
  id: number;
  title: string;
  state: MutationState;
  lines: OutputLine[];
}

/** Bounds memory when a command prints without end. */
const MAX_RUNS = 10;
const MAX_LINES = 2000;

export function isActive(run: MutationRun): boolean {
  return run.state.kind === "queued" || run.state.kind === "running";
}

export function useMutations(api: CoreApi): MutationRun[] {
  const [runs, setRuns] = useState<MutationRun[]>([]);

  useEffect(() => {
    const subscription = api.onEvent((event) => setRuns((current) => reduce(current, event)));
    return () => {
      void subscription.then((unsubscribe) => unsubscribe());
    };
  }, [api]);

  return runs;
}

function reduce(runs: MutationRun[], event: CoreEvent): MutationRun[] {
  switch (event.type) {
    case "mutationQueued": {
      const queued: MutationRun = {
        id: event.mutation.id,
        title: event.mutation.title,
        state: { kind: "queued" },
        lines: [],
      };
      return [...runs, queued].slice(-MAX_RUNS);
    }
    case "mutationStarted":
      return update(runs, event.mutationId, (run) => ({ ...run, state: { kind: "running" } }));
    case "mutationOutput":
      return update(runs, event.mutationId, (run) => ({
        ...run,
        lines: appendLine(run.lines, {
          stream: event.stream,
          text: event.text,
          transient: event.transient,
        }),
      }));
    case "mutationFinished":
      return update(runs, event.mutationId, (run) => ({
        ...run,
        state: event.outcome,
      }));
    default:
      return runs;
  }
}

function update(
  runs: MutationRun[],
  id: number,
  change: (run: MutationRun) => MutationRun,
): MutationRun[] {
  return runs.map((run) => (run.id === id ? change(run) : run));
}

function appendLine(lines: OutputLine[], line: OutputLine): OutputLine[] {
  const kept = lines.at(-1)?.transient ? lines.slice(0, -1) : lines;
  return [...kept, line].slice(-MAX_LINES);
}
