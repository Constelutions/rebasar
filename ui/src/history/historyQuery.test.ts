import { addTerm, removeTerm, termValues } from "./historyQuery";

describe("termValues", () => {
  it("lists the values of every term of a key, in the order typed", () => {
    expect(termValues("fix author:ada branch:main author:grace", "author")).toEqual(["ada", "grace"]);
  });

  it("reads quoted values with their spaces and escapes", () => {
    const query = 'author:"Ada Lovelace" author:"say \\"hi\\" \\\\"';
    expect(termValues(query, "author")).toEqual(["Ada Lovelace", 'say "hi" \\']);
  });

  it("takes the key in any case and ignores text that only looks like a key", () => {
    expect(termValues("AUTHOR:ada notauthor:grace http://x author:", "author")).toEqual(["ada", ""]);
  });

  it("is empty for a query without the key", () => {
    expect(termValues("fix parser", "author")).toEqual([]);
  });
});

describe("addTerm", () => {
  it("appends the term after what is already typed", () => {
    expect(addTerm("fix", "author", "ada")).toBe("fix author:ada");
    expect(addTerm("", "author", "ada")).toBe("author:ada");
    expect(addTerm("fix   ", "branch", "main")).toBe("fix branch:main");
  });

  it("quotes a value that has spaces or quotes", () => {
    expect(addTerm("", "author", "Ada Lovelace")).toBe('author:"Ada Lovelace"');
    expect(addTerm("", "author", 'say "hi"')).toBe('author:"say \\"hi\\""');
  });

  it("writes a term the parser reads back to the same value", () => {
    const value = 'odd "name" \\ with spaces';
    expect(termValues(addTerm("fix", "author", value), "author")).toEqual([value]);
  });
});

describe("removeTerm", () => {
  it("removes the term with that value and leaves the rest of the text alone", () => {
    expect(removeTerm("fix author:ada  path:src author:grace", "author", "ada")).toBe(
      "fix path:src author:grace",
    );
  });

  it("matches the value without regard to case and removes a quoted term whole", () => {
    expect(removeTerm('author:"Ada Lovelace" fix', "author", "ada lovelace")).toBe("fix");
  });

  it("removes every term of the key when no value is given", () => {
    expect(removeTerm("author:ada fix author:grace", "author")).toBe("fix");
  });

  it("removes a term at the end without leaving a trailing space", () => {
    expect(removeTerm("fix author:ada", "author", "ada")).toBe("fix");
  });

  it("leaves the query as it is when nothing matches", () => {
    expect(removeTerm("fix  author:ada", "author", "grace")).toBe("fix  author:ada");
  });
});
