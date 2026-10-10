import { highlightLines } from "./highlightLines";
import { languageFor } from "./languages";
import { tokensByLine } from "./tokens";

describe("languageFor", () => {
  it("picks the language from the file extension", () => {
    expect(languageFor("src/App.tsx")).toBe("typescript");
    expect(languageFor("crates/core/src/lib.rs")).toBe("rust");
    expect(languageFor("Cargo.TOML")).toBe("ini");
  });

  it("has no language for files it does not know", () => {
    expect(languageFor("LICENSE")).toBeNull();
    expect(languageFor("notes.txt")).toBeNull();
    expect(languageFor("docs.d/readme")).toBeNull();
  });
});

describe("highlightLines", () => {
  it("returns one token list per line, with the keywords and strings told apart", () => {
    const lines = highlightLines("typescript", ['const name = "rebasar";', "return name;"]);

    expect(lines).toHaveLength(2);
    expect(lines[0]?.find((token) => token.text === "const")?.kind).toBe("keyword");
    expect(lines[0]?.find((token) => token.text.includes("rebasar"))?.kind).toBe("string");
    expect(lines[0]?.map((token) => token.text).join("")).toBe('const name = "rebasar";');
  });

  it("keeps a comment that spans lines highlighted on every line", () => {
    const lines = highlightLines("typescript", ["/* first", "second */"]);

    expect(lines[0]?.[0]?.kind).toBe("comment");
    expect(lines[1]?.[0]?.kind).toBe("comment");
  });

  it("returns the lines untouched for a language that is not registered", () => {
    expect(highlightLines("brainfuck", ["+[-]"])).toEqual([[{ text: "+[-]", kind: null }]]);
  });

  it("never turns the code into markup", () => {
    const [line] = highlightLines("xml", ["<b>&amp;</b>"]);

    expect(line?.map((token) => token.text).join("")).toBe("<b>&amp;</b>");
  });
});

describe("tokensByLine", () => {
  it("decodes the entities highlight.js escapes", () => {
    expect(tokensByLine("a &lt; b &amp;&amp; c &gt; &quot;d&quot; &#x27;e&#x27;")).toEqual([
      [{ text: `a < b && c > "d" 'e'`, kind: null }],
    ]);
  });

  it("uses the innermost known kind for nested spans", () => {
    const html = '<span class="hljs-string">"a <span class="hljs-subst">${b}</span>"</span>';

    expect(tokensByLine(html)[0]?.map((token) => token.kind)).toEqual(["string"]);
  });
});
