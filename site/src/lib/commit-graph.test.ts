import { describe, expect, it } from "vitest";
import { layoutGraph, ROW_HEIGHT, type GraphCommit } from "./commit-graph";

const commit = (lane: number, parents: number[]): GraphCommit => ({
  hash: "0000000",
  message: "",
  lane,
  author: "Mara",
  age: "1h",
  parents,
});

describe("layoutGraph", () => {
  it("draws a straight line through every row between a commit and its parent", () => {
    const rows = layoutGraph([commit(0, [2]), commit(1, [2]), commit(0, [])]);

    expect(rows[0]).toHaveLength(1);
    expect(rows[0]![0]).toMatchObject({ x1: 22, y1: ROW_HEIGHT / 2, x2: 22, y2: ROW_HEIGHT });
    expect(rows[2]![0]).toMatchObject({ y1: 0, y2: ROW_HEIGHT / 2 });
  });

  it("bends the edge toward the parent's lane when the lanes differ", () => {
    const rows = layoutGraph([commit(1, [1]), commit(0, [])]);

    expect(rows[0]).toContainEqual(expect.objectContaining({ x1: 48, x2: 22, y2: ROW_HEIGHT }));
  });
});
