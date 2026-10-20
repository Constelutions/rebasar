import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Button } from "./Button";

it("renders a secondary button of regular size by default", () => {
  render(<Button>Fetch</Button>);

  const button = screen.getByRole("button", { name: "Fetch" });

  expect(button).toHaveClass("button", "button-secondary", "button-md");
});

it("does not submit a surrounding form unless it is a submit button", async () => {
  const user = userEvent.setup();
  const onSubmit = vi.fn((event: { preventDefault: () => void }) => event.preventDefault());
  render(
    <form onSubmit={onSubmit}>
      <Button>Cancel</Button>
      <Button type="submit">Save</Button>
    </form>,
  );

  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(onSubmit).not.toHaveBeenCalled();

  await user.click(screen.getByRole("button", { name: "Save" }));
  expect(onSubmit).toHaveBeenCalledTimes(1);
});

it.each(["primary", "danger"] as const)("takes the %s variant from the design tokens", (variant) => {
  render(<Button variant={variant}>Go</Button>);

  expect(screen.getByRole("button", { name: "Go" })).toHaveClass("button", `button-${variant}`);
});

it("offers a small size for buttons that sit in rows", () => {
  render(<Button size="sm">Merge</Button>);

  expect(screen.getByRole("button", { name: "Merge" })).toHaveClass("button-sm");
});

it("leaves the theme to the caller's own class when the variant is plain", () => {
  render(
    <Button variant="plain" className="sidebar-item">
      Home
    </Button>,
  );

  const button = screen.getByRole("button", { name: "Home" });

  expect(button).toHaveClass("sidebar-item");
  expect(button).not.toHaveClass("button");
});

it("passes the usual button attributes through", async () => {
  const user = userEvent.setup();
  const onClick = vi.fn();
  render(
    <Button aria-pressed="true" disabled onClick={onClick}>
      Off
    </Button>,
  );

  const button = screen.getByRole("button", { name: "Off" });
  await user.click(button);

  expect(button).toBeDisabled();
  expect(button).toHaveAttribute("aria-pressed", "true");
  expect(onClick).not.toHaveBeenCalled();
});

it("forwards a ref to the button element", () => {
  const ref = { current: null as HTMLButtonElement | null };
  render(<Button ref={ref}>Focus</Button>);

  expect(ref.current).toBe(screen.getByRole("button", { name: "Focus" }));
});
