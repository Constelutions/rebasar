import { Button } from "../components/Button";
import { TextInput } from "../components/FormControls";
import { MultiSelect, type MultiSelectOption } from "../components/MultiSelect";
import type { HistoryCount } from "../core/api";
import { MY_COMMITS, addTerm, removeTerm, termValues } from "./historyQuery";

export interface Chips {
  allBranches: boolean;
  merges: boolean;
}

interface FilterBarProps {
  query: string;
  onQueryChange: (query: string) => void;
  chips: Chips;
  onChipsChange: (chips: Chips) => void;
  /** The branches and the authors to pick from; anything already in the query is listed too. */
  branches: string[];
  authors: string[];
  count: HistoryCount | null;
  queryError: string | null;
}

export function FilterBar({
  query,
  onQueryChange,
  chips,
  onChipsChange,
  branches,
  authors,
  count,
  queryError,
}: FilterBarProps) {
  const selectedBranches = termValues(query, "branch");
  const selectedAuthors = termValues(query, "author");

  return (
    <div role="group" aria-label="History filter" className="filter-bar">
      <TextInput
        type="search"
        aria-label="Filter commits"
        placeholder="author:  path:  msg:  branch:  since:  until:"
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
      />
      <MultiSelect
        label="Branches"
        summary={summarise(selectedBranches, chips.allBranches ? "All branches" : "Current branch", "branches")}
        presets={[
          {
            label: "All branches",
            active: selectedBranches.length === 0 && chips.allBranches,
            onChoose: () => {
              onQueryChange(removeTerm(query, "branch"));
              onChipsChange({ ...chips, allBranches: true });
            },
          },
          {
            label: "Current branch",
            active: selectedBranches.length === 0 && !chips.allBranches,
            onChoose: () => {
              onQueryChange(removeTerm(query, "branch"));
              onChipsChange({ ...chips, allBranches: false });
            },
          },
        ]}
        options={optionsFor(branches.map((name) => ({ value: name, label: name })), selectedBranches)}
        onToggle={(value, checked) =>
          onQueryChange(checked ? addTerm(query, "branch", value) : removeTerm(query, "branch", value))
        }
      />
      <MultiSelect
        label="Authors"
        summary={summarise(
          selectedAuthors.map((value) => (isMe(value) ? "Me" : value)),
          "Everyone",
          "authors",
        )}
        presets={[
          {
            label: "Everyone",
            active: selectedAuthors.length === 0,
            onChoose: () => onQueryChange(removeTerm(query, "author")),
          },
        ]}
        options={optionsFor(
          [{ value: MY_COMMITS, label: "Me" }, ...authors.map((name) => ({ value: name, label: name }))],
          selectedAuthors,
        )}
        onToggle={(value, checked) =>
          onQueryChange(checked ? addTerm(query, "author", value) : removeTerm(query, "author", value))
        }
      />
      <Button
        variant="plain"
        type="button"
        className="chip"
        aria-pressed={chips.merges}
        onClick={() => onChipsChange({ ...chips, merges: !chips.merges })}
      >
        Merges
      </Button>
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

function isMe(value: string): boolean {
  return value.toLowerCase() === MY_COMMITS;
}

/** Checks the options the query names, and lists the ones it names that are not among the choices. */
function optionsFor(
  choices: { value: string; label: string }[],
  selected: string[],
): MultiSelectOption[] {
  const chosen = new Set(selected.map((value) => value.toLowerCase()));
  const known = new Set(choices.map(({ value }) => value.toLowerCase()));
  const unlisted = selected
    .filter((value, index) => !known.has(value.toLowerCase()) && selected.indexOf(value) === index)
    .map((value) => ({ value, label: value }));
  return [...choices, ...unlisted].map(({ value, label }) => ({
    value,
    label,
    checked: chosen.has(value.toLowerCase()),
  }));
}

const SUMMARY_NAMES = 2;

function summarise(selected: string[], nothingSelected: string, plural: string): string {
  if (selected.length === 0) return nothingSelected;
  if (selected.length <= SUMMARY_NAMES) return selected.join(", ");
  return `${selected.length} ${plural}`;
}

function describeCount({ matching, total }: HistoryCount): string {
  const noun = total === 1 ? "commit" : "commits";
  return `${matching.toLocaleString("en-US")} of ${total.toLocaleString("en-US")} ${noun}`;
}
