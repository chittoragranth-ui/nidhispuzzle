import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Maximize, Minus, Plus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { buildGeometry, piecePath, workspaceBounds, type Geometry } from "@/lib/jigsaw";
import type { RoomBus } from "@/lib/room-bus";

export interface PieceState {
  idx: number;
  x: number;
  y: number;
  locked: boolean;
  held_by: string | null;
  version: number;
}

interface Props {
  sessionId: string;
  aspect: number;
  seed: number;
  cols: number;
  rows: number;
  image: HTMLImageElement;
  pieces: PieceState[];
  setPieces: React.Dispatch<React.SetStateAction<PieceState[]>>;
  bus: RoomBus;
  meId: string;
  partnerName?: string;
  showReference: boolean;
}

function renderPieceImages(g: Geometry, img: HTMLImageElement, cols: number, rows: number) {
  const k = Math.min(2, Math.max(0.6, img.naturalWidth / g.boardW)) * Math.min(2, window.devicePixelRatio || 1);
  const w = g.cw + 2 * g.pad;
  const h = g.ch + 2 * g.pad;
  const out: string[] = [];
  for (let i = 0; i < cols * rows; i++) {
    const c = document.createElement("canvas");
    c.width = Math.ceil(w * k);
    c.height = Math.ceil(h * k);
    const ctx = c.getContext("2d")!;
    ctx.scale(k, k);
    const path = new Path2D(piecePath(g, i, cols, rows));
    ctx.save();
    ctx.clip(path);
    const cx = (i % cols) * g.cw;
    const cy = Math.floor(i / cols) * g.ch;
    ctx.translate(g.pad - cx, g.pad - cy);
    ctx.drawImage(img, 0, 0, g.boardW, g.boardH);
    ctx.restore();
    ctx.lineWidth = 0.8;
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.stroke(path);
    out.push(c.toDataURL("image/png"));
  }
  return out;
}

const Piece = memo(function Piece(props: {
  p: PieceState; g: Geometry; path: string; src?: string; z: number;
  mine: boolean; partner: boolean; snapping: boolean;
  onDown: (e: React.PointerEvent, idx: number) => void;
}) {
  const { p, g, path, src, z, mine, partner, snapping } = props;
  return (
    <div
      className={`piece-wrap absolute left-0 top-0 ${p.locked ? "is-locked" : ""} ${mine || partner ? "is-lifted" : ""}`}
      style={{
        width: g.cw + 2 * g.pad, height: g.ch + 2 * g.pad,
        transform: `translate(${p.x - g.pad}px, ${p.y - g.pad}px)`,
        zIndex: p.locked ? 1 : z, pointerEvents: "none",
      }}
    >
      <div
        className={snapping ? "piece-snap h-full w-full" : "h-full w-full"}
        style={{ clipPath: `path('${path}')`, pointerEvents: p.locked ? "none" : "auto", cursor: p.locked ? "default" : partner ? "not-allowed" : "grab", touchAction: "none" }}
        onPointerDown={(e) => props.onDown(e, p.idx)}
      >
        {src && <img src={src} alt="" draggable={false} className="h-full w-full select-none" />}
      </div>
      {partner && (
        <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
          <path d={path} fill="none" className="stroke-partner" strokeWidth={3} />
        </svg>
      )}
    </div>
  );
});

export function PuzzleBoard({ sessionId, aspect, seed, cols, rows, image, pieces, setPieces, bus, meId, partnerName, showReference }: Props) {
  const g = useMemo(() => buildGeometry({ aspect, seed, cols, rows }), [aspect, seed, cols, rows]);
  const paths = useMemo(() => Array.from({ length: cols * rows }, (_, i) => piecePath(g, i, cols, rows)), [g, cols, rows]);
  const [srcs, setSrcs] = useState<string[]>([]);
  const [view, setView] = useState({ tx: 0, ty: 0, z: 0.3 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const vpRef = useRef<HTMLDivElement>(null);
  const [zs, setZs] = useState<Record<number, number>>({});
  const zCounter = useRef(10);
  const [snapping, setSnapping] = useState<Set<number>>(new Set());
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const drag = useRef<{ idx: number; ox: number; oy: number; startX: number; startY: number; pointer: number; lastSent: number; granted: boolean | null; refresh?: number } | null>(null);
  const pan = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d: number; z: number; cx: number; cy: number; tx: number; ty: number } | null>(null);
  const lastCursor = useRef(0);

  useEffect(() => {
    // Defer so the room shell paints first.
    const t = setTimeout(() => setSrcs(renderPieceImages(g, image, cols, rows)), 30);
    return () => clearTimeout(t);
  }, [g, image, cols, rows]);

  const fit = useCallback(() => {
    const el = vpRef.current;
    if (!el) return;
    const b = workspaceBounds(g);
    const bw = b.maxX - b.minX, bh = b.maxY - b.minY;
    const z = Math.min(el.clientWidth / bw, el.clientHeight / bh) * 0.96;
    setView({ z, tx: el.clientWidth / 2 - (b.minX + bw / 2) * z, ty: el.clientHeight / 2 - (b.minY + bh / 2) * z });
  }, [g]);
  useEffect(() => { fit(); }, [fit]);

  const clampView = useCallback((v: { tx: number; ty: number; z: number }) => {
    const el = vpRef.current;
    if (!el) return v;
    const b = workspaceBounds(g);
    const z = Math.max(0.12, Math.min(4, v.z));
    const minTx = el.clientWidth * 0.2 - b.maxX * z, maxTx = el.clientWidth * 0.8 - b.minX * z;
    const minTy = el.clientHeight * 0.2 - b.maxY * z, maxTy = el.clientHeight * 0.8 - b.minY * z;
    return { z, tx: Math.min(maxTx, Math.max(minTx, v.tx)), ty: Math.min(maxTy, Math.max(minTy, v.ty)) };
  }, [g]);

  const zoomAt = useCallback((factor: number, sx: number, sy: number) => {
    setView((v) => {
      const z = Math.max(0.12, Math.min(4, v.z * factor));
      const wx = (sx - v.tx) / v.z, wy = (sy - v.ty) / v.z;
      return clampView({ z, tx: sx - wx * z, ty: sy - wy * z });
    });
  }, [clampView]);

  useEffect(() => {
    const el = vpRef.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      if (e.ctrlKey || Math.abs(e.deltaY) > Math.abs(e.deltaX) * 2 && !e.shiftKey && e.deltaMode !== 0) {
        zoomAt(Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top);
      } else if (e.ctrlKey === false && e.deltaMode === 0 && Math.abs(e.deltaX) < 1 && Number.isInteger(e.deltaY) && Math.abs(e.deltaY) >= 50) {
        zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top); // mouse wheel
      } else {
        setView((v) => clampView({ ...v, tx: v.tx - e.deltaX, ty: v.ty - e.deltaY })); // trackpad pan
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt, clampView]);

  const toWorld = (cx: number, cy: number) => {
    const r = vpRef.current!.getBoundingClientRect();
    const v = viewRef.current;
    return { x: (cx - r.left - v.tx) / v.z, y: (cy - r.top - v.ty) / v.z };
  };

  const updatePiece = useCallback((idx: number, patch: Partial<PieceState>) => {
    setPieces((ps) => ps.map((p) => (p.idx === idx ? { ...p, ...patch } : p)));
  }, [setPieces]);

  const flashSnap = (idx: number) => {
    setSnapping((s) => new Set(s).add(idx));
    setTimeout(() => setSnapping((s) => { const n = new Set(s); n.delete(idx); return n; }), 340);
  };

  // Remote transient events
  useEffect(() => {
    const offs = [
      bus.on("move", ({ idx, x, y, by }) => {
        if (drag.current?.idx === idx) return;
        updatePiece(idx, { x, y, held_by: by });
        setZs((z) => ({ ...z, [idx]: ++zCounter.current }));
      }),
      bus.on("drop", ({ idx, x, y, locked }) => {
        if (drag.current?.idx === idx) return;
        updatePiece(idx, { x, y, locked, held_by: null });
        if (locked) flashSnap(idx);
      }),
      bus.on("cursor", (c) => setCursor(c)),
      bus.on("cursor-off", () => setCursor(null)),
    ];
    return () => offs.forEach((o) => o());
  }, [bus, updatePiece]);

  // Authoritative durable updates
  useEffect(() => {
    const ch = supabase
      .channel(`pieces:${sessionId}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "pieces", filter: `session_id=eq.${sessionId}` }, (payload) => {
        const n = payload.new as PieceState;
        if (drag.current?.idx === n.idx && n.held_by === meId) return;
        setPieces((ps) => ps.map((p) => {
          if (p.idx !== n.idx || n.version < p.version) return p;
          if (n.locked && !p.locked) flashSnap(n.idx);
          return { idx: n.idx, x: n.x, y: n.y, locked: n.locked, held_by: n.held_by, version: n.version };
        }));
      })
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [sessionId, meId, setPieces]);

  const onPieceDown = useCallback((e: React.PointerEvent, idx: number) => {
    if (e.button !== 0 || pointers.current.size > 0) return;
    const p = pieces.find((q) => q.idx === idx);
    if (!p || p.locked) return;
    if (p.held_by && p.held_by !== meId) { toast(`${partnerName ?? "Your partner"} is moving that piece.`); return; }
    e.stopPropagation();
    vpRef.current!.setPointerCapture(e.pointerId);
    const w = toWorld(e.clientX, e.clientY);
    drag.current = { idx, ox: w.x - p.x, oy: w.y - p.y, startX: p.x, startY: p.y, pointer: e.pointerId, lastSent: 0, granted: null };
    setZs((z) => ({ ...z, [idx]: ++zCounter.current }));
    updatePiece(idx, { held_by: meId });
    const d = drag.current;
    supabase.rpc("grab_piece", { _session: sessionId, _idx: idx }).then(({ data, error }) => {
      if (drag.current !== d && d.granted === null) { d.granted = !!data && !error; return; }
      d.granted = !!data && !error;
      if (!d.granted) {
        drag.current = null;
        updatePiece(idx, { x: d.startX, y: d.startY, held_by: null });
        toast("Someone else grabbed that piece first.");
      } else {
        d.refresh = window.setInterval(() => supabase.rpc("grab_piece", { _session: sessionId, _idx: idx }), 10000);
      }
    });
  }, [pieces, meId, partnerName, sessionId, updatePiece]);

  const finishDrag = async () => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    if (d.refresh) clearInterval(d.refresh);
    const p = pieces.find((q) => q.idx === d.idx);
    if (!p) return;
    // wait for lease outcome
    for (let i = 0; i < 40 && d.granted === null; i++) await new Promise((r) => setTimeout(r, 50));
    if (!d.granted) { updatePiece(d.idx, { x: d.startX, y: d.startY, held_by: null }); return; }
    const { data, error } = await supabase.rpc("drop_piece", { _session: sessionId, _idx: d.idx, _x: p.x, _y: p.y });
    if (error) { toast("Connection hiccup — that move didn't save."); updatePiece(d.idx, { x: d.startX, y: d.startY, held_by: null }); return; }
    const r = data as { x: number; y: number; locked: boolean; rejected?: boolean };
    setPieces((ps) => ps.map((q) => (q.idx === d.idx ? { ...q, x: r.x, y: r.y, locked: !!r.locked, held_by: null, version: q.version + 2 } : q)));
    if (r.locked) flashSnap(d.idx);
    bus.send("drop", { idx: d.idx, x: r.x, y: r.y, locked: !!r.locked });
  };

  const onDown = (e: React.PointerEvent) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    vpRef.current!.setPointerCapture(e.pointerId);
    if (pointers.current.size === 2) {
      pan.current = null;
      const [a, b] = [...pointers.current.values()];
      const r = vpRef.current!.getBoundingClientRect();
      pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y), z: view.z, cx: (a.x + b.x) / 2 - r.left, cy: (a.y + b.y) / 2 - r.top, tx: view.tx, ty: view.ty };
    } else if (!drag.current) {
      pan.current = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty };
    }
  };

  const onMove = (e: React.PointerEvent) => {
    const now = performance.now();
    if (now - lastCursor.current > 60) {
      lastCursor.current = now;
      const w = toWorld(e.clientX, e.clientY);
      bus.send("cursor", w);
    }
    const d = drag.current;
    if (d && e.pointerId === d.pointer) {
      const w = toWorld(e.clientX, e.clientY);
      const b = workspaceBounds(g);
      const x = Math.max(b.minX, Math.min(b.maxX - g.cw, w.x - d.ox));
      const y = Math.max(b.minY, Math.min(b.maxY - g.ch, w.y - d.oy));
      updatePiece(d.idx, { x, y });
      if (now - d.lastSent > 40) { d.lastSent = now; bus.send("move", { idx: d.idx, x, y, by: meId }); }
      return;
    }
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch.current && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const pc = pinch.current;
      const z = Math.max(0.12, Math.min(4, pc.z * (Math.hypot(a.x - b.x, a.y - b.y) / pc.d)));
      const wx = (pc.cx - pc.tx) / pc.z, wy = (pc.cy - pc.ty) / pc.z;
      setView(clampView({ z, tx: pc.cx - wx * z, ty: pc.cy - wy * z }));
    } else if (pan.current) {
      setView(clampView({ z: view.z, tx: pan.current.tx + e.clientX - pan.current.x, ty: pan.current.ty + e.clientY - pan.current.y }));
    }
  };

  const onUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (pointers.current.size === 0) pan.current = null;
    if (drag.current && e.pointerId === drag.current.pointer) void finishDrag();
  };

  const el = vpRef.current;
  return (
    <div
      ref={vpRef}
      className="relative h-full w-full touch-none select-none overflow-hidden bg-board"
      style={{ cursor: pan.current ? "grabbing" : "default" }}
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
      onPointerLeave={() => bus.send("cursor-off", {})}
    >
      <div className="absolute left-0 top-0 origin-top-left" style={{ transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.z})` }}>
        <div className="absolute rounded-sm border border-dashed border-muted-foreground/40 bg-card/60"
          style={{ left: 0, top: 0, width: g.boardW, height: g.boardH }} />
        {pieces.map((p) => (
          <Piece key={p.idx} p={p} g={g} path={paths[p.idx]} src={srcs[p.idx]} z={zs[p.idx] ?? 2}
            mine={drag.current?.idx === p.idx} partner={!!p.held_by && p.held_by !== meId}
            snapping={snapping.has(p.idx)} onDown={onPieceDown} />
        ))}
        {cursor && (
          <div className="pointer-events-none absolute left-0 top-0" style={{ transform: `translate(${cursor.x}px, ${cursor.y}px) scale(${1 / view.z})`, zIndex: 99999 }}>
            <div className="h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card bg-partner" />
            <span className="ml-2 rounded bg-partner px-1.5 py-0.5 text-[11px] text-primary-foreground">{partnerName}</span>
          </div>
        )}
      </div>

      {srcs.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">Cutting 100 pieces…</div>
      )}

      {showReference && (
        <img src={image.src} alt="Reference picture" className="surface pointer-events-none absolute bottom-4 left-4 w-48 p-1 md:w-64" />
      )}

      <div className="surface absolute bottom-4 right-4 flex items-center gap-1 p-1">
        <button className="btn-icon" aria-label="Zoom out" onClick={() => el && zoomAt(1 / 1.25, el.clientWidth / 2, el.clientHeight / 2)}><Minus className="h-4 w-4" /></button>
        <button className="btn-icon" aria-label="Fit board" onClick={fit}><Maximize className="h-4 w-4" /></button>
        <button className="btn-icon" aria-label="Zoom in" onClick={() => el && zoomAt(1.25, el.clientWidth / 2, el.clientHeight / 2)}><Plus className="h-4 w-4" /></button>
      </div>
    </div>
  );
}
