import { describe, expect, it } from "vitest";
import { buildGeometry, initialLayout, pieceSides, PIECE_COUNT, workspaceBounds } from "@/lib/jigsaw";

const spec = { aspect: 1.5, seed: 42, cols: 10, rows: 10 };

describe("jigsaw engine", () => {
  it("has exactly 100 pieces", () => {
    expect(PIECE_COUNT).toBe(100);
  });

  it("neighbouring edges interlock (tab meets blank)", () => {
    const g = buildGeometry(spec);
    for (let i = 0; i < 100; i++) {
      const s = pieceSides(g, i, 10, 10);
      if (i % 10 < 9) expect(s.right).toBe(-pieceSides(g, i + 1, 10, 10).left);
      if (i < 90) expect(s.bottom).toBe(-pieceSides(g, i + 10, 10, 10).top);
    }
  });

  it("outer edges are flat", () => {
    const g = buildGeometry(spec);
    expect(pieceSides(g, 0, 10, 10).top).toBe(0);
    expect(pieceSides(g, 0, 10, 10).left).toBe(0);
    expect(pieceSides(g, 99, 10, 10).right).toBe(0);
    expect(pieceSides(g, 99, 10, 10).bottom).toBe(0);
  });

  it("same seed gives identical geometry on both clients", () => {
    expect(buildGeometry(spec)).toEqual(buildGeometry(spec));
  });

  it("initial layout keeps every piece inside the workspace and off the frame", () => {
    const g = buildGeometry(spec);
    const b = workspaceBounds(g);
    const pos = initialLayout(g, 42);
    expect(pos).toHaveLength(100);
    for (const [x, y] of pos) {
      expect(x).toBeGreaterThanOrEqual(b.minX);
      expect(x + g.cw).toBeLessThanOrEqual(b.maxX);
      expect(y).toBeGreaterThanOrEqual(b.minY);
      const onFrame = x + g.cw > 0 && x < g.boardW && y + g.ch > 0 && y < g.boardH;
      expect(onFrame).toBe(false);
    }
  });
});
