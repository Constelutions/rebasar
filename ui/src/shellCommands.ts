import { useEffect, useMemo, useState } from "react";

import type { CoreApi, RefLabel } from "./core/api";
import type { AddKind } from "./components/AddRepositoryDialog";
import { describeHead } from "./components/TabStrip";
import { usePalette, usePaletteCommands } from "./palette/PaletteProvider";
import type { PaletteCommand, PaletteContext } from "./palette/registry";
import type { AppWindow } from "./shell/appWindow";
import { shortcuts } from "./shortcuts";
import type { OpenTab } from "./useOpenTabs";
import { type ViewName, viewGroups } from "./views";

interface ShellCommandHandlers {
  api: CoreApi;
  appWindow: AppWindow;
  openTabs: OpenTab[];
  activeTab: OpenTab | undefined;
  view: ViewName;
  openFolder: () => void;
  selectTab: (worktreePath: string) => void;
  showView: (view: ViewName) => void;
  /** Shows History narrowed by the filter `query`. */
  showCommits: (query: string) => void;
  addRepository: (kind: AddKind) => void;
}

/** Registers what the title bar, the sidebar and the Tab strip let the user do. */
export function useShellCommands({
  api,
  appWindow,
  openTabs,
  activeTab,
  view,
  openFolder,
  selectTab,
  showView,
  showCommits,
  addRepository,
}: ShellCommandHandlers) {
  const windowCommands = useMemo<PaletteCommand[]>(
    () => [
      {
        id: "shell.open-folder",
        title: "Open folder…",
        group: "Repository",
        keywords: ["add", "repository", "worktree"],
        shortcut: shortcuts.openFolder.label,
        run: openFolder,
      },
      {
        id: "shell.clone-repository",
        title: "Clone repository…",
        group: "Repository",
        keywords: ["add", "url", "git clone"],
        run: () => addRepository("clone"),
      },
      {
        id: "shell.init-repository",
        title: "Initialise repository…",
        group: "Repository",
        keywords: ["add", "new", "git init"],
        run: () => addRepository("init"),
      },
      {
        id: "shell.scan-folder",
        title: "Scan folder for repositories…",
        group: "Repository",
        keywords: ["add", "import", "find"],
        run: () => addRepository("scan"),
      },
      {
        id: "window.minimize",
        title: "Minimize window",
        group: "Window",
        run: () => appWindow.minimize(),
      },
      {
        id: "window.toggle-maximize",
        title: "Maximize or restore window",
        group: "Window",
        run: () => appWindow.toggleMaximize(),
      },
      {
        id: "window.close",
        title: "Close window",
        group: "Window",
        keywords: ["quit", "exit"],
        run: () => appWindow.close(),
      },
    ],
    [appWindow, openFolder, addRepository],
  );

  const operationCommands = useMemo<PaletteCommand[]>(
    () => [
      {
        id: "operation.continue",
        title: "Continue the operation in progress",
        group: "Operation",
        keywords: ["merge", "rebase", "cherry-pick", "revert"],
        when: (context) => context.activeTab?.operation?.conflicts === 0,
        run: ({ activeTab }) => {
          if (activeTab) void api.continueOperation(activeTab.tab.worktreePath);
        },
      },
      {
        id: "operation.skip",
        title: "Skip the current commit of the operation in progress",
        group: "Operation",
        keywords: ["rebase", "cherry-pick", "revert"],
        when: (context) => context.activeTab?.operation?.canSkip === true,
        run: ({ activeTab }) => {
          if (activeTab) void api.skipOperation(activeTab.tab.worktreePath);
        },
      },
    ],
    [api],
  );

  const viewCommands = useMemo<PaletteCommand[]>(
    () =>
      viewGroups.flat().map((name) => ({
        id: `view.${name.toLowerCase().replace(/\s+/g, "-")}`,
        title: `Go to ${name}`,
        group: "Navigate",
        when: (context) => context.view !== name,
        run: () => showView(name),
      })),
    [showView],
  );

  const tabCommands = useMemo<PaletteCommand[]>(
    () =>
      openTabs.map(({ tab }) => ({
        id: `tab.${tab.worktreePath}`,
        title: `Go to Tab ${tab.repositoryName} · ${describeHead(tab.head)}`,
        group: "Tabs",
        keywords: ["worktree", "repository", tab.worktreePath],
        when: (context) => context.activeTab?.tab.worktreePath !== tab.worktreePath,
        run: () => selectTab(tab.worktreePath),
      })),
    [openTabs, selectTab],
  );

  const branches = useBranches(api, activeTab?.tab.worktreePath);
  const branchCommands = useMemo<PaletteCommand[]>(
    () =>
      branches.flatMap(({ name, kind }) => [
        {
          id: `branch.${name}`,
          title: `Show branch ${name}`,
          group: "Branches",
          keywords: ["history", "checkout"],
          run: () => showCommits(`branch:${name}`),
        },
        ...(kind === "localBranch" || kind === "remoteBranch"
          ? [
              {
                id: `branch.checkout.${name}`,
                title: `Check out branch ${name}`,
                group: "Branches",
                keywords: ["switch", "checkout"],
                run: ({ activeTab }: PaletteContext) => {
                  if (activeTab) {
                    void api.checkoutBranch(
                      activeTab.tab.worktreePath,
                      name,
                      kind === "remoteBranch",
                    );
                  }
                },
              },
            ]
          : []),
      ]),
    [api, branches, showCommits],
  );

  usePaletteCommands(windowCommands);
  usePaletteCommands(operationCommands);
  usePaletteCommands(viewCommands);
  usePaletteCommands(tabCommands);
  usePaletteCommands(branchCommands);
}

/** The branches of the Tab in front, read each time the palette opens so they are current. */
function useBranches(api: CoreApi, worktreePath: string | undefined): RefLabel[] {
  const { isOpen } = usePalette();
  const [loaded, setLoaded] = useState<{ worktreePath: string; branches: RefLabel[] } | null>(null);

  useEffect(() => {
    if (!isOpen || worktreePath === undefined) return;
    let current = true;
    api.listBranches(worktreePath).then(
      (branches) => current && setLoaded({ worktreePath, branches }),
      () => {
        // The palette still works without branches; a broken Worktree reports itself elsewhere.
      },
    );
    return () => {
      current = false;
    };
  }, [api, worktreePath, isOpen]);

  return loaded !== null && loaded.worktreePath === worktreePath ? loaded.branches : [];
}
