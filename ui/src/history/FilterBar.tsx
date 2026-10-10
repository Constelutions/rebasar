import type { HistoryCount } from "../core/api";

export interface Chips {
  allBranches: boolean;
  mine: boolean;
  merges: boolean;
}

const chipLabels: Record<keyof Chips, string> = {
  allBranches: "All branches",
  mine: "Mine",
  merges: "Merges",
};

interface FilterBarProps {
  query: string;
  onQueryChange: (query: string) => void;
  chips: Chips;
  onChipsChange: (chips: Chips) => void;
  count: HistoryCount | null;
  queryError: string | null;
}

export function FilterBar({
  query,
  onQueryChange,
  chips,
  onChipsChange,
  count,
  queryError,
}: FilterBarProps) {
  return (
    <div className="filter-bar">
      <input
        type="search"
        className="filter-input"
        aria-label="Filter commits"
        placeholder="author:  path:  msg:  branch:  since:  until:"
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
      />
      {(Object.keys(chipLabels) as (keyof Chips)[]).map((chip) => (
        <button
          key={chip}
          type="button"
          className="chip"
          aria-pressed={chips[chip]}
          onClick={() => onChipsChange({ ...chips, [chip]: !chips[chip] })}
        >
          {chipLabels[chip]}
        </button>
      ))}
      <span role="status" className="filter-count">
        {count === null ? "Counting commits…" : describeCount(count)}
      </span>
      {queryError !== null && (
        <p role="alert" className="filter-error">
          {queryError}
        </p>
      )}
    </div>
  );
}

function describeCount({ matching, total }: HistoryCount): string {
  const noun = total === 1 ? "commit" : "commits";
  return `${matching.toLocaleString("en-US")} of ${total.toLocaleString("en-US")} ${noun}`;
}
