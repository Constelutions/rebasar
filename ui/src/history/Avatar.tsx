import { categoryOf } from "./geometry";

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = words[0] ?? "";
  const last = words.length > 1 ? (words.at(-1) ?? "") : "";
  return ([...first][0] ?? "") + ([...last][0] ?? "") || "?";
}

export function Avatar({ name, email }: { name: string; email: string }) {
  return (
    <span title={`${name} <${email}>`} className={`avatar category-${categoryOf(email)}`}>
      {initials(name).toUpperCase()}
    </span>
  );
}
