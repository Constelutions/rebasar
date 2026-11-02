import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ActionMenu, type MenuItem, OptionsButton, useActionMenu } from "./components/ActionMenu";

function Harness({ items }: { items: MenuItem[] }) {
  const { open, close, openFromButton, openFromContextMenu } = useActionMenu();
  return (
    <div onContextMenu={openFromContextMenu}>
      <p>Row</p>
      <OptionsButton label="Row options" expanded={open !== null} onClick={openFromButton} />
      {open && <ActionMenu label="Row actions" items={items} x={open.x} y={open.y} onClose={close} />}
    </div>
  );
}

it("opens from the options button and runs the chosen item", async () => {
  const user = userEvent.setup();
  const run = vi.fn();
  render(<Harness items={[{ key: "rename", label: "Rename", run }]} />);

  await user.click(screen.getByRole("button", { name: "Row options" }));
  await user.click(screen.getByRole("menuitem", { name: "Rename" }));

  expect(run).toHaveBeenCalledOnce();
  expect(screen.queryByRole("menu")).toBeNull();
});

it("opens on a right-click and closes on Escape", async () => {
  const user = userEvent.setup();
  render(<Harness items={[{ key: "rename", label: "Rename", run: () => {} }]} />);

  await user.pointer({ keys: "[MouseRight]", target: screen.getByText("Row") });
  expect(screen.getByRole("menu", { name: "Row actions" })).toBeInTheDocument();

  await user.keyboard("{Escape}");
  expect(screen.queryByRole("menu")).toBeNull();
});

it("moves focus between items with the arrow keys", async () => {
  const user = userEvent.setup();
  render(
    <Harness
      items={[
        { key: "a", label: "First", run: () => {} },
        { key: "b", label: "Second", run: () => {} },
      ]}
    />,
  );

  await user.click(screen.getByRole("button", { name: "Row options" }));
  expect(screen.getByRole("menuitem", { name: "First" })).toHaveFocus();

  await user.keyboard("{ArrowDown}");
  expect(screen.getByRole("menuitem", { name: "Second" })).toHaveFocus();
});

it("expands a submenu in place and runs one of its items", async () => {
  const user = userEvent.setup();
  const run = vi.fn();
  render(
    <Harness
      items={[{ key: "open", label: "Open in…", submenu: [{ key: "zed", label: "Zed", run }] }]}
    />,
  );

  await user.click(screen.getByRole("button", { name: "Row options" }));
  expect(screen.queryByRole("menuitem", { name: "Zed" })).toBeNull();

  await user.click(screen.getByRole("menuitem", { name: "Open in…" }));
  await user.click(screen.getByRole("menuitem", { name: "Zed" }));

  expect(run).toHaveBeenCalledOnce();
});

it("does not run a disabled item", async () => {
  const user = userEvent.setup();
  const run = vi.fn();
  render(<Harness items={[{ key: "x", label: "Delete", run, disabled: true }]} />);

  await user.click(screen.getByRole("button", { name: "Row options" }));
  await user.click(screen.getByRole("menuitem", { name: "Delete" }));

  expect(run).not.toHaveBeenCalled();
});
