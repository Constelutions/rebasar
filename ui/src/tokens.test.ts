import { readFileSync } from "node:fs";
import { join } from "node:path";

function readStyle(name: string) {
  return readFileSync(join(__dirname, name), "utf-8");
}

function declarations(css: string) {
  return [...css.matchAll(/(?<name>--[\w-]+)\s*:\s*(?<value>[^;]+);/g)].map(({ groups }) => ({
    name: groups?.name ?? "",
    value: groups?.value?.trim() ?? "",
  }));
}

const tokens = declarations(readStyle("tokens.css"));

function token(name: string) {
  return tokens.find((declaration) => declaration.name === name)?.value;
}

it("defaults the interface font to Geist and the monospace font to JetBrains Mono", () => {
  expect(token("--font-ui")).toMatch(/^"?Geist/);
  expect(token("--font-mono")).toMatch(/^"?JetBrains Mono/);
});

it("defines the palette as colour tokens", () => {
  const colours = tokens.filter(({ name }) => name.startsWith("--color-"));

  expect(colours.map(({ name }) => name)).toEqual(
    expect.arrayContaining([
      "--color-bg",
      "--color-surface",
      "--color-border",
      "--color-text",
      "--color-text-muted",
      "--color-accent",
      "--color-danger",
    ]),
  );
  expect(colours.every(({ value }) => value.startsWith("oklch("))).toBe(true);
});

it("defines a spacing scale and a type scale", () => {
  const names = tokens.map(({ name }) => name);

  expect(names).toEqual(expect.arrayContaining(["--space-1", "--space-2", "--space-3", "--space-4"]));
  expect(names).toEqual(expect.arrayContaining(["--text-sm", "--text-md", "--text-lg"]));
});

it("keeps colour and font values out of the component styles so a theme is a token swap", () => {
  const componentStyles = readStyle("styles.css");

  expect(componentStyles).not.toMatch(/#[0-9a-f]{3,8}\b|oklch\(|rgba?\(|hsla?\(/i);
  expect(componentStyles).not.toMatch(/font-family\s*:\s*(?!var\()/);
});
