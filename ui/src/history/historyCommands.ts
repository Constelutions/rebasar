import { useMemo } from "react";

import { usePaletteCommands } from "../palette/PaletteProvider";
import type { PaletteCommand } from "../palette/registry";
import type { Chips } from "./FilterBar";

export const defaultChips: Chips = { allBranches: true, mine: false, merges: false };

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
  const isFiltered =
    queryText !== "" ||
    chips.allBranches !== defaultChips.allBranches ||
    chips.mine ||
    chips.merges;

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
        title: chips.mine ? "Show everyone's commits" : "Show only my commits",
        group: "History",
        keywords: ["filter", "chip", "mine", "author"],
        run: () => setChips({ ...chips, mine: !chips.mine }),
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
    [chips, isFiltered, setChips, setQueryText],
  );

  usePaletteCommands(commands);
}
