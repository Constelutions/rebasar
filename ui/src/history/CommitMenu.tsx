import { ActionMenu, type MenuItem } from "../components/ActionMenu";

export type CommitAction =
  | "checkout"
  | "createBranch"
  | "createTag"
  | "copyHash"
  | "reword"
  | "compare"
  | "rebase"
  | "cherryPick"
  | "revert"
  | "resetSoft"
  | "resetMixed"
  | "resetHard";

const items: { action: CommitAction; label: string }[] = [
  { action: "checkout", label: "Checkout (detached)" },
  { action: "createBranch", label: "Create branch here…" },
  { action: "createTag", label: "Create tag here…" },
  { action: "copyHash", label: "Copy hash" },
  { action: "reword", label: "Reword…" },
  { action: "compare", label: "Compare with working tree" },
  { action: "rebase", label: "Interactive rebase from here…" },
  { action: "cherryPick", label: "Cherry-pick" },
  { action: "revert", label: "Revert" },
  { action: "resetSoft", label: "Reset soft to here" },
  { action: "resetMixed", label: "Reset mixed to here" },
  { action: "resetHard", label: "Reset hard to here" },
];

interface CommitMenuProps {
  x: number;
  y: number;
  onSelect: (action: CommitAction) => void;
  onClose: () => void;
}

export function CommitMenu({ x, y, onSelect, onClose }: CommitMenuProps) {
  const menuItems: MenuItem[] = items.map(({ action, label }) => ({
    key: action,
    label,
    run: () => onSelect(action),
  }));
  return <ActionMenu label="Commit actions" items={menuItems} x={x} y={y} onClose={onClose} />;
}
