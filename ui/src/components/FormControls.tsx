import type { ComponentPropsWithRef } from "react";

function withThemeClass(theme: string, className: string | undefined) {
  return className ? `${theme} ${className}` : theme;
}

/**
 * Every text input, select and textarea in the views goes through here so they all share the Settings
 * look. Checkboxes and radios are not text controls and stay plain inputs.
 */
export function TextInput({ className, ...props }: ComponentPropsWithRef<"input">) {
  return <input className={withThemeClass("text-input", className)} {...props} />;
}

export function Select({ className, ...props }: ComponentPropsWithRef<"select">) {
  return <select className={withThemeClass("select", className)} {...props} />;
}

export function TextArea({ className, ...props }: ComponentPropsWithRef<"textarea">) {
  return <textarea className={withThemeClass("text-input text-area", className)} {...props} />;
}
