const WORD_START = /[\s\-_/.:·]/;

/**
 * How well `needle` matches `haystack` as a subsequence, ignoring case and whitespace in the
 * needle; higher is better, `null` means it does not match. Letters that follow each other and
 * letters that start a word score extra, and a shorter haystack wins a tie.
 */
export function fuzzyScore(needle: string, haystack: string): number | null {
  const wanted = needle.toLowerCase().replace(/\s+/g, "");
  const text = haystack.toLowerCase();

  let score = 0;
  let from = 0;
  let previous = -2;
  for (const letter of wanted) {
    const at = text.indexOf(letter, from);
    if (at < 0) return null;
    score += 1;
    if (at === previous + 1) score += 3;
    if (at === 0 || WORD_START.test(text[at - 1] ?? "")) score += 2;
    score -= (at - from) * 0.05;
    previous = at;
    from = at + 1;
  }
  return score - text.length * 0.01;
}
