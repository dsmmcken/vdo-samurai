import { useEffect, useRef, useState } from 'react';
import type { Room, Snapshot } from '../lib/room';
import type { Corner, PipShape } from '../lib/types';
import type { Head } from '../lib/framing';
import { CUTOUT_HEAD_TOP, PIP_DIMS, cutoutHeadX } from '../lib/overlay';
import { Avatar } from './Avatar';
import { CutoutView, type CutState } from './cutout-view';
import { EyeOff, Eye, User } from './icons';
import { Video } from './Video';

const CORNERS: Corner[] = ['tl', 'tr', 'bl', 'br'];

const SHAPES: { shape: PipShape; label: string; icon: React.ReactNode }[] = [
  { shape: 'cutout', label: 'Cutout', icon: <User size={16} /> },
  { shape: 'circle', label: 'Circle', icon: <span className="shape-glyph circle" /> },
  { shape: 'square', label: 'Square', icon: <span className="shape-glyph square" /> },
  { shape: 'rect', label: 'Rectangle', icon: <span className="shape-glyph rect" /> },
];

const GAP = 18; // px from the shape's outline to each icon's centre
const STEP = 30; // px between icons along that outline

/**
 * Icon positions hugging the shape: walk an outline offset GAP outside it,
 * centred on the inner corner (the one facing the stage centre), STEP apart.
 * The path is the corner's rounding arc continued along the two straight
 * edges, so icons follow a rectangle's or square's corner closely and, for a
 * circle, arc along the circle itself. Returned in px relative to the box's
 * top-left, for a box w x h with corner radius r.
 */
function hugPoints(corner: Corner, w: number, h: number, r: number, n: number): Pt[] {
  const rho = r + GAP;
  const quarter = (rho * Math.PI) / 2;
  // Solve for the inner corner at the box's top-left, then mirror.
  const at = (s: number): Pt => {
    // s = 0 at the middle of the corner arc; + toward the top edge, - toward the left edge.
    if (Math.abs(s) <= quarter / 2) {
      const th = ((225 + (s / rho) * (180 / Math.PI)) * Math.PI) / 180;
      return [r + rho * Math.cos(th), r + rho * Math.sin(th)];
    }
    const past = Math.abs(s) - quarter / 2;
    return s > 0 ? [Math.min(w - r, r + past), -GAP] : [-GAP, Math.min(h - r, r + past)];
  };
  const mirrorX = corner.endsWith('l'); // inner corner is on the right
  const mirrorY = corner.startsWith('t'); // ...or at the bottom
  return Array.from({ length: n }, (_, i) => {
    const [x, y] = at((i - (n - 1) / 2) * STEP);
    return [mirrorX ? w - x : x, mirrorY ? h - y : y] as Pt;
  });
}

/**
 * Icon positions for a cutout: a level row just above the head (at `headX`
 * across and `headTop` down the box, as fractions), centred on it, in the
 * same order as along the arcs (so switching shapes slides them across
 * rather than shuffling them).
 */
function rowPoints(corner: Corner, w: number, h: number, n: number, headX: number, headTop: number): Pt[] {
  const dir = corner.endsWith('r') ? 1 : -1;
  const cx = Math.min(w - STEP, Math.max(STEP, w * headX));
  const y = h * headTop - GAP;
  return Array.from({ length: n }, (_, i) => [cx + dir * (i - (n - 1) / 2) * STEP, y] as Pt);
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
 * - Hover it: cutout / circle / square / rectangle / hide pop out in an arc
 *   from its inner corner, hugging the shape; over a cutout they line up
 *   above the head. A hidden overlay shows an unhide button when you hover
 *   its corner.
 * - The cutout is just the person, background removed, drawn by its own
 *   worker into a canvas under the overlay (cutout-view.ts), which also plays
 *   the morph to and from the boxes.
 * Anyone can change it before a take; during a take, only the Shōgun.
 */
export function Pip({ room, s, stream, mirror, off, head, name }: { room: Room; s: Snapshot; stream: MediaStream | null; mirror: boolean; off: boolean; head: Head | null; name: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ x: number; y: number; dx: number; dy: number; near: Corner } | null>(null);
  const canMove = !s.recording || s.director === s.me;
  const { hidden } = s.pip;

  // The cutout: its canvas lives in `cutHost`; `shown` is the shape the frame
  // and menu use (it waits while the cutout gets ready to morph).
  const cutHost = useRef<HTMLDivElement>(null);
  const view = useRef<CutoutView | null>(null);
  const cutProps = { shape: s.pip.shape, corner: s.corner, hidden, off: off || !stream, mirror, head };
  const [cut, setCut] = useState<CutState>({ shown: s.pip.shape, face: 'shown', canvasOn: false, fade: false, status: 'idle', headX: cutoutHeadX(s.corner), headTop: CUTOUT_HEAD_TOP });
  useEffect(() => {
    const v = new CutoutView(cutHost.current!, cutProps, setCut);
    view.current = v;
    return () => {
      v.close();
      view.current = null;
    };
  }, []);
  useEffect(() => view.current?.update(cutProps), [cutProps.shape, cutProps.corner, hidden, cutProps.off, mirror, head?.x, head?.y, head?.s]);
  const trackIds = stream?.getVideoTracks().map((t) => t.id).join() ?? '';
  useEffect(() => view.current?.setStream(stream), [stream, trackIds]);
  const shape = cut.shown;
  const cutFace = shape === 'cutout' && cut.status !== 'failed' && !off;

  // Shape changes slide the icons smoothly (not with the pop-out's bounce),
  // once they've popped out.
  const [settled, setSettled] = useState(false);

  // The hover menu stays open while the pointer is inside the convex hull of
  // the overlay and its icons: a "safe cone" that covers the way across to
  // them from any side. Leaving it (with a short grace) closes the menu.
  const [menu, setMenu] = useState(false);
  const settleUntil = useRef(0); // no hover menu while it glides after a drop
  const [scale, setScale] = useState(0); // stage px per 1080p px
  useEffect(() => {
    const frame = ref.current?.parentElement;
    if (!frame) return;
    const ro = new ResizeObserver(() => setScale(frame.clientWidth / 1920));
    ro.observe(frame);
    return () => ro.disconnect();
  }, []);
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
    view.current?.finish();
    setMenu(false); // picking it up closes the menu (not just hides it)
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
    // It's about to glide to its corner, possibly under the pointer: that
    // isn't a hover. The menu waits until it has come to rest.
    settleUntil.current = performance.now() + 500;
    setMenu(false);
    room.setCorner(drag.near);
    setDrag(null);
  };

  useEffect(() => {
    if (!menu) return setSettled(false);
    const t = setTimeout(() => setSettled(true), 420);
    return () => clearTimeout(t);
  }, [menu]);

  // Icons start at the inner corner of the box (facing the stage centre) and
  // pop out to points hugging the current shape. They're placed from that
  // corner, which follows the frame as it glides to a new shape's size.
  const d = PIP_DIMS[shape];
  const [w, h, r] = [d.w * scale, d.h * scale, d.r * scale];
  const ox = s.corner.endsWith('r') ? 0 : w;
  const oy = s.corner.startsWith('b') ? 0 : h;
  const n = SHAPES.length + 1;
  const points = shape === 'cutout' ? rowPoints(s.corner, w, h, n, cut.headX, cut.headTop) : hugPoints(s.corner, w, h, r, n);

  return (
    <>
      {drag && CORNERS.map((c) => <div key={c} className={`pip-zone c-${c} s-${shape} ${drag.near === c ? 'near' : ''}`} aria-hidden />)}
      <div
        ref={ref}
        className={`pip c-${s.corner} s-${shape} ${hidden ? 'hidden' : ''} ${drag ? 'dragging' : ''} ${canMove ? 'movable' : ''} ${menu && !drag && !hidden ? 'menu' : ''} ${settled ? 'settled' : ''}`}
        style={drag ? { left: drag.x, top: drag.y } : undefined}
        // Move as well as enter: after a drop the pointer may already be over it
        // once it has settled.
        onPointerEnter={() => canMove && !hidden && !drag && performance.now() > settleUntil.current && setMenu(true)}
        onPointerMove={() => !menu && !drag && canMove && !hidden && performance.now() > settleUntil.current && setMenu(true)}
      >
        <div className={`pip-face ${cutFace ? 'cut' : ''} ${cut.face === 'shown' ? '' : cut.face}`} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} title={canMove && !hidden ? 'Drag to another corner' : undefined}>
          {off ? <Avatar name={name} /> : cutFace ? null : <Video stream={stream} mirror={mirror} head={head} />}
        </div>

        {canMove && !drag && !hidden && (
          <div ref={actionsRef} className="pip-actions" style={{ '--ix': ox ? '100%' : '0%', '--iy': oy ? '100%' : '0%' } as React.CSSProperties}>
            {[...SHAPES.map((x) => ({ ...x, kind: 'shape' as const })), { shape: null, label: 'Hide', icon: <EyeOff size={17} />, kind: 'hide' as const }].map((a, i) => {
              const [px, py] = points[i];
              return (
                <button
                  key={a.label}
                  className={`pip-act ${a.kind === 'shape' && a.shape === s.pip.shape ? 'on' : ''}`}
                  style={{ '--dx': `${px - ox}px`, '--dy': `${py - oy}px`, '--i': i } as React.CSSProperties}
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

      </div>
      {/* The cutout's canvas: placed like a cutout-shaped overlay, under the
          overlay's frame (so the box covers it until a morph starts). */}
      <div
        ref={cutHost}
        className={`pip-cut c-${s.corner} s-cutout ${cut.canvasOn && !off ? 'on' : ''} ${cut.fade ? 'fade' : ''} ${hidden ? 'hidden' : ''} ${drag ? 'dragging' : ''}`}
        style={drag && shape === 'cutout' ? { left: drag.x, top: drag.y } : undefined}
        aria-hidden
      />
      {/* Hidden: every corner offers to bring it back there, in case you've
          forgotten where it was. It moves while invisible, then grows in. */}
      {canMove &&
        hidden &&
        CORNERS.map((c) => (
          <div key={c} className={`pip-spot c-${c} s-${shape}`}>
            <button
              className="pip-unhide"
              onClick={() => {
                room.setCorner(c);
                setTimeout(() => room.setPip({ hidden: false }), 30);
              }}
              aria-label={`Show camera overlay ${{ tl: 'top left', tr: 'top right', bl: 'bottom left', br: 'bottom right' }[c]}`}
              title="Show camera overlay here"
            >
              <Eye size={18} />
            </button>
          </div>
        ))}
    </>
  );
}
