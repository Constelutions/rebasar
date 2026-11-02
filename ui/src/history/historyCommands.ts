import { useMemo } from "react";

import { usePaletteCommands } from "../palette/PaletteProvider";
import type { PaletteCommand } from "../palette/registry";
import type { Chips } from "./FilterBar";
import { MY_COMMITS, addTerm, removeTerm, termValues } from "./historyQuery";

export const defaultChips: Chips = { allBranches: true, merges: false };

interface HistoryFilterControls {
  queryText: string;
  setQueryText: (query: string) => void;
  chips: Chips;
  setChips: (chips: Chips) => void;
}

/** The History filter's chips and a reset, listed in the palette while History is on show. */
export function useHistoryCommands({
  queryText,
  setQueryText,
  chips,
  setChips,
}: HistoryFilterControls) {
  const isFiltered = queryText !== "" || chips.allBranches !== defaultChips.allBranches || chips.merges;
  const showsMine = termValues(queryText, "author").some((author) => author.toLowerCase() === MY_COMMITS);

  const commands = useMemo<PaletteCommand[]>(
    () => [
      {
        id: "history.toggle-all-branches",
        title: chips.allBranches ? "Show only the current branch" : "Show all branches",
        group: "History",
        keywords: ["filter", "chip", "all branches"],
        run: () => setChips({ ...chips, allBranches: !chips.allBranches }),
      },
      {
        id: "history.toggle-mine",
        title: showsMine ? "Show everyone's commits" : "Show only my commits",
        group: "History",
        keywords: ["filter", "chip", "mine", "author"],
        run: () =>
          setQueryText(
            showsMine
              ? removeTerm(queryText, "author", MY_COMMITS)
              : addTerm(queryText, "author", MY_COMMITS),
          ),
      },
      {
        id: "history.toggle-merges",
        title: chips.merges ? "Show all commits, not only merges" : "Show only merge commits",
        group: "History",
        keywords: ["filter", "chip", "merges"],
        run: () => setChips({ ...chips, merges: !chips.merges }),
      },
      {
        id: "history.clear-filter",
        title: "Clear the History filter",
        group: "History",
        keywords: ["reset", "query", "chips"],
        when: () => isFiltered,
        run: () => {
          setQueryText("");
          setChips(defaultChips);
        },
      },
    ],
    [chips, isFiltered, queryText, setChips, setQueryText, showsMine],
  );

  usePaletteCommands(commands);
}
