import type { ComponentPropsWithRef } from "react";

export type ButtonVariant = "secondary" | "primary" | "danger" | "plain";
export type ButtonSize = "md" | "sm";

interface ButtonProps extends ComponentPropsWithRef<"button"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

/**
 * Every button in the views goes through here so the theme reaches all of them. `plain` opts out of the
 * shared look for controls that carry a look of their own, such as tabs, chips and sidebar items.
 */
export function Button({
  variant = "secondary",
  size = "md",
  type = "button",
  className,
  ...props
}: ButtonProps) {
  const themed = variant === "plain" ? [] : ["button", `button-${variant}`, `button-${size}`];
  const classes = [...themed, className].filter(Boolean).join(" ");
  return <button type={type} className={classes || undefined} {...props} />;
}
