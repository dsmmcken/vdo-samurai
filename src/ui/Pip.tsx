import { useEffect, useRef, useState } from 'react';
import type { Room, Snapshot } from '../lib/room';
import type { Corner, PipShape } from '../lib/types';
import { Avatar } from './Avatar';
import { EyeOff, Eye } from './icons';
import { Video } from './Video';

const CORNERS: Corner[] = ['tl', 'tr', 'bl', 'br'];

const SHAPES: { shape: PipShape; label: string; icon: React.ReactNode }[] = [
  { shape: 'circle', label: 'Circle', icon: <span className="shape-glyph circle" /> },
  { shape: 'square', label: 'Square', icon: <span className="shape-glyph square" /> },
  { shape: 'rect', label: 'Rectangle', icon: <span className="shape-glyph rect" /> },
];

/**
 * Angles (degrees, y down) of an arc that opens toward the stage centre from a
 * corner. It fans 15° past each edge so the icons sit close without touching.
 */
function arc(corner: Corner, n: number) {
  const across = corner.endsWith('r') ? 180 : 0; // toward the middle horizontally
  const along = corner.startsWith('b') ? (across === 180 ? 270 : -90) : 90; // ...and vertically
  const dir = Math.sign(along - across);
  const from = across - 15 * dir;
  const to = along + 15 * dir;
  return Array.from({ length: n }, (_, i) => from + ((to - from) * i) / (n - 1));
}

type Pt = [number, number];
/** Convex hull (monotone chain), counter-clockwise. */
function hull(points: Pt[]): Pt[] {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: Pt, a: Pt, b: Pt) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Pt[] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: Pt[] = [];
  for (const q of [...p].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}
function inside(poly: Pt[], [x, y]: Pt) {
  for (let i = 0; i < poly.length; i++) {
    const [ax, ay] = poly[i];
    const [bx, by] = poly[(i + 1) % poly.length];
    if ((bx - ax) * (y - ay) - (by - ay) * (x - ax) < 0) return false;
  }
  return true;
}
const corners = (r: DOMRect, pad = 0): Pt[] => [
  [r.left - pad, r.top - pad],
  [r.right + pad, r.top - pad],
  [r.right + pad, r.bottom + pad],
  [r.left - pad, r.bottom + pad],
];

/**
 * The presenter's camera over a shared screen.
 * - Drag it toward any corner: drop zones appear, the nearest lights up, and on
 *   release it glides there for everyone (and in the final cut).
 * - Hover it: circle / square / rectangle / hide pop out in an arc from its
 *   inner corner. A hidden overlay shows an unhide button when you hover its
 *   corner.
 * Anyone can change it before a take; during a take, only the Shōgun.
 */
export function Pip({ room, s, stream, mirror, off, name }: { room: Room; s: Snapshot; stream: MediaStream | null; mirror: boolean; off: boolean; name: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ x: number; y: number; dx: number; dy: number; near: Corner } | null>(null);
  const canMove = !s.recording || s.director === s.me;
  const { shape, hidden } = s.pip;

  // The hover menu stays open while the pointer is inside the convex hull of
  // the overlay and its icons: a "safe cone" that covers the way across to
  // them from any side. Leaving it (with a short grace) closes the menu.
  const [menu, setMenu] = useState(false);
  const actionsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const move = (e: PointerEvent) => {
      const face = ref.current?.getBoundingClientRect();
      const icons = [...(actionsRef.current?.querySelectorAll('.pip-act') ?? [])].map((el) => el.getBoundingClientRect());
      if (!face) return;
      const safe = hull([...corners(face, 4), ...icons.flatMap((r) => corners(r, 8))]);
      if (inside(safe, [e.clientX, e.clientY])) {
        if (timer) clearTimeout(timer);
        timer = null;
      } else timer ??= setTimeout(() => setMenu(false), 150);
    };
    window.addEventListener('pointermove', move);
    return () => {
      window.removeEventListener('pointermove', move);
      if (timer) clearTimeout(timer);
    };
  }, [menu]);

  const nearest = (cx: number, cy: number, frame: DOMRect): Corner =>
    `${cy < frame.top + frame.height / 2 ? 't' : 'b'}${cx < frame.left + frame.width / 2 ? 'l' : 'r'}` as Corner;

  const onDown = (e: React.PointerEvent) => {
    if (!canMove || hidden || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const frame = ref.current.parentElement!.getBoundingClientRect();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({ x: r.left - frame.left, y: r.top - frame.top, dx: e.clientX - r.left, dy: e.clientY - r.top, near: s.corner });
  };
  const onMove = (e: React.PointerEvent) => {
    if (!drag || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const frame = ref.current.parentElement!.getBoundingClientRect();
    const x = Math.max(0, Math.min(frame.width - r.width, e.clientX - frame.left - drag.dx));
    const y = Math.max(0, Math.min(frame.height - r.height, e.clientY - frame.top - drag.dy));
    setDrag({ ...drag, x, y, near: nearest(frame.left + x + r.width / 2, frame.top + y + r.height / 2, frame) });
  };
  const onUp = () => {
    if (!drag) return;
    room.setCorner(drag.near);
    setDrag(null);
  };

  // Inner corner of the overlay (facing the stage centre), in % of its box.
  const ix = s.corner.endsWith('r') ? '0%' : '100%';
  const iy = s.corner.startsWith('b') ? '0%' : '100%';
  const angles = arc(s.corner, 4);
  const R = 40; // px from the inner corner to each icon's centre

  return (
    <>
      {drag && CORNERS.map((c) => <div key={c} className={`pip-zone c-${c} s-${shape} ${drag.near === c ? 'near' : ''}`} aria-hidden />)}
      <div
        ref={ref}
        className={`pip c-${s.corner} s-${shape} ${hidden ? 'hidden' : ''} ${drag ? 'dragging' : ''} ${canMove ? 'movable' : ''} ${menu && !drag && !hidden ? 'menu' : ''}`}
        style={drag ? { left: drag.x, top: drag.y } : undefined}
        onPointerEnter={() => canMove && !hidden && setMenu(true)}
      >
        <div className="pip-face" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} title={canMove && !hidden ? 'Drag to another corner' : undefined}>
          {off ? <Avatar name={name} /> : <Video stream={stream} mirror={mirror} />}
        </div>

        {canMove && !drag && !hidden && (
          <div ref={actionsRef} className="pip-actions" style={{ '--ix': ix, '--iy': iy } as React.CSSProperties}>
            {[...SHAPES.map((x) => ({ ...x, kind: 'shape' as const })), { shape: null, label: 'Hide', icon: <EyeOff size={17} />, kind: 'hide' as const }].map((a, i) => {
              const rad = (angles[i] * Math.PI) / 180;
              return (
                <button
                  key={a.label}
                  className={`pip-act ${a.kind === 'shape' && a.shape === shape ? 'on' : ''}`}
                  style={{ '--dx': `${Math.cos(rad) * R}px`, '--dy': `${Math.sin(rad) * R}px`, '--i': i } as React.CSSProperties}
                  onClick={() => {
                    if (a.kind === 'hide') {
                      room.setPip({ hidden: true });
                      setMenu(false);
                    } else room.setPip({ shape: a.shape! });
                  }}
                  aria-label={a.kind === 'hide' ? 'Hide camera overlay' : `${a.label} overlay`}
                  title={a.kind === 'hide' ? 'Hide' : a.label}
                >
                  {a.icon}
                </button>
              );
            })}
          </div>
        )}

        {canMove && hidden && (
          <button className="pip-unhide" onClick={() => room.setPip({ hidden: false })} aria-label="Show camera overlay" title="Show camera overlay">
            <Eye size={18} />
          </button>
        )}
      </div>
    </>
  );
}
