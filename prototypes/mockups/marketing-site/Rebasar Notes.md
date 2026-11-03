# Rebasar mockups: placeholders and assumptions

Files: `Rebasar Mockups.dc.html` (comparison canvas), `Rebasar Site.dc.html` (the page; fluid, props: os, installOpen), `assets/logo.png` (your app icon).

## Sample data (verify against the product)
- Repositories: api-gateway, billing-service, infra, web-app. Branches: main, feat/invoice-export, fix/token-refresh, chore/deps, perf/route-cache.
- People: Mara Ilves (MI), Tomás Reyes (TR), Jun Park (JP), Sam Okoye (SO). All commit messages, hashes, ages, PR numbers (#482, #487, #491), the v0.9.0 tag, stash names and remote URLs are invented.
- Sidebar counts (Changes 3, Branches 6, Stashes 2, Pull requests 3) and the "3 changed" worktree state are invented.
- Windows-style window controls in the faux title bar.
- Worktree paths (`~/work/api-gateway-invoice`, `~/work/api-gateway-token`) are invented.
- Safety dialog: the four files and their line counts (3, 8, 1, 5) are invented; only "3 uncommitted lines in `src/billing/invoice.ts`" comes from the brief.
- Terminal comments (`# opens the Worktree containing the current folder`, `# or from anywhere`) are paraphrased from the capability list.

## Judgement calls
- **Reflog line.** The brief asks for a line saying the reflog is the only recovery path. Uncommitted lines are never in the reflog, so the dialog says: "Rebasar has no undo. Anything already committed can still be recovered through Git's reflog; uncommitted lines cannot." Change if you prefer different wording.
- **"About 3 ms" tab switching** is verbatim from the brief but is not in the measured-performance table.
- **Perf tiles** add the target from the table under each number and "20 Repositories and 50 Worktrees" to the memory label.
- **Recommended card.** Mocked as Windows. `os` prop switches the label ("Download for Linux") and highlights the Debian/Ubuntu card.
- Download buttons all link to `/releases` (not `/releases/latest`).
- Added copy: faux-UI labels, "Operation in progress", "Worktrees of api-gateway", "3 open as Tabs", the nav menu, "Filter commits…".
- Palette query "inv" is used so every result type (command, Tab, branch, commit) matches it.

## Build notes
- Mobile is the same page at 390px (container-width driven); the hero panel is cropped to 420px high, not scaled.
- Hero A only; Hero B has been removed.
- Faux-UI panels are `aria-hidden`; card titles and copy are real text.
- Not implemented: `prefers-reduced-motion` only removes the short hover transitions (there is no other motion).
