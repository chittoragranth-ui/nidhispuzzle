// Deterministic jigsaw geometry shared by both clients.
// Board units: the finished puzzle is BOARD_W wide and BOARD_W / aspect tall,
// origin at the puzzle's top-left corner.

export const BOARD_W = 1000;
export const COLS = 10;
export const ROWS = 10;
export const PIECE_COUNT = COLS * ROWS;

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface PuzzleSpec {
  aspect: number; // width / height
  seed: number;
  cols: number;
  rows: number;
}

export interface Geometry {
  boardW: number;
  boardH: number;
  cw: number;
  ch: number;
  pad: number;
  /** hEdges[r][c]: edge below row r at column c, +1 bulges down */
  hEdges: number[][];
  /** vEdges[r][c]: edge right of column c at row r, +1 bulges right */
  vEdges: number[][];
}

export function buildGeometry(spec: PuzzleSpec): Geometry {
  const boardW = BOARD_W;
  const boardH = BOARD_W / spec.aspect;
  const cw = boardW / spec.cols;
  const ch = boardH / spec.rows;
  const rand = mulberry32(spec.seed);
  const hEdges: number[][] = [];
  for (let r = 0; r < spec.rows - 1; r++) {
    hEdges.push(Array.from({ length: spec.cols }, () => (rand() < 0.5 ? 1 : -1)));
  }
  const vEdges: number[][] = [];
  for (let r = 0; r < spec.rows; r++) {
    vEdges.push(Array.from({ length: spec.cols - 1 }, () => (rand() < 0.5 ? 1 : -1)));
  }
  return { boardW, boardH, cw, ch, pad: Math.min(cw, ch) * 0.34, hEdges, vEdges };
}

// Normalised tab: [u along edge, v outward]. Each entry is a cubic segment.
const TAB: [number, number][][] = [
  [[0.32, 0], [0.42, 0.02], [0.38, 0.12]],
  [[0.32, 0.27], [0.42, 0.33], [0.5, 0.33]],
  [[0.58, 0.33], [0.68, 0.27], [0.62, 0.12]],
  [[0.58, 0.02], [0.68, 0], [1, 0]],
];

type Pt = [number, number];

function edgeSegment(a: Pt, b: Pt, bulge: number, size: number): string {
  if (bulge === 0) return `L${fmt(b[0])},${fmt(b[1])}`;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  const nx = dy / len; // outward normal for clockwise traversal (y down)
  const ny = -dx / len;
  const map = ([u, v]: [number, number]): string => {
    const px = a[0] + u * dx + v * bulge * size * nx;
    const py = a[1] + u * dy + v * bulge * size * ny;
    return `${fmt(px)},${fmt(py)}`;
  };
  return TAB.map((seg) => `C${seg.map(map).join(" ")}`).join(" ");
}

function fmt(n: number) {
  return Math.round(n * 100) / 100;
}

export function pieceSides(g: Geometry, idx: number, cols: number, rows: number) {
  const r = Math.floor(idx / cols);
  const c = idx % cols;
  return {
    top: r === 0 ? 0 : -g.hEdges[r - 1][c],
    right: c === cols - 1 ? 0 : g.vEdges[r][c],
    bottom: r === rows - 1 ? 0 : g.hEdges[r][c],
    left: c === 0 ? 0 : -g.vEdges[r][c - 1],
  };
}

/** SVG path of a piece in piece-local coordinates (cell top-left at (pad, pad)). */
export function piecePath(g: Geometry, idx: number, cols: number, rows: number): string {
  const s = pieceSides(g, idx, cols, rows);
  const p = g.pad;
  const size = Math.min(g.cw, g.ch);
  const tl: Pt = [p, p];
  const tr: Pt = [p + g.cw, p];
  const br: Pt = [p + g.cw, p + g.ch];
  const bl: Pt = [p, p + g.ch];
  return [
    `M${tl[0]},${tl[1]}`,
    edgeSegment(tl, tr, s.top, size),
    edgeSegment(tr, br, s.right, size),
    edgeSegment(br, bl, s.bottom, size),
    edgeSegment(bl, tl, s.left, size),
    "Z",
  ].join(" ");
}

export function correctPosition(g: Geometry, idx: number, cols: number) {
  return { x: (idx % cols) * g.cw, y: Math.floor(idx / cols) * g.ch };
}

/** Workspace bounds (board units) — must match server clamp in drop_piece. */
export function workspaceBounds(g: Geometry) {
  return {
    minX: -0.9 * g.boardW,
    maxX: 1.8 * g.boardW,
    minY: -0.9 * g.boardH,
    maxY: 1.8 * g.boardH,
  };
}

/** Deterministic, non-overlapping scatter of pieces around the frame. */
export function initialLayout(g: Geometry, seed: number, count = PIECE_COUNT): [number, number][] {
  const rand = mulberry32(seed ^ 0x9e3779b9);
  const b = workspaceBounds(g);
  const margin = Math.min(g.cw, g.ch) * 0.5;
  for (let step = 1.4; step > 0.8; step -= 0.05) {
    const sx = g.cw * step;
    const sy = g.ch * step;
    const slots: [number, number][] = [];
    for (let y = b.minY + g.pad; y + g.ch + g.pad <= b.maxY; y += sy) {
      for (let x = b.minX + g.pad; x + g.cw + g.pad <= b.maxX; x += sx) {
        const insideFrame =
          x + g.cw > -margin &&
          x < g.boardW + margin &&
          y + g.ch > -margin &&
          y < g.boardH + margin;
        if (!insideFrame) slots.push([x, y]);
      }
    }
    if (slots.length >= count) {
      // Prefer slots closest to the frame so pieces stay near the action.
      const cx = g.boardW / 2;
      const cy = g.boardH / 2;
      slots.sort(
        (p, q) => Math.hypot(p[0] - cx, p[1] - cy) - Math.hypot(q[0] - cx, q[1] - cy),
      );
      const chosen = slots.slice(0, count);
      for (let i = chosen.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [chosen[i], chosen[j]] = [chosen[j], chosen[i]];
      }
      return chosen.map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10]);
    }
  }
  throw new Error("Could not lay out pieces");
}

/** Must match the server snap tolerance in drop_piece. */
export function snapTolerance(g: Geometry) {
  return g.cw * 0.28;
}
