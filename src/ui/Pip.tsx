import { useRef, useState } from 'react';
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

/** Angles (degrees, y down) of an arc that opens toward the stage centre from a corner. */
function arc(corner: Corner, n: number) {
  const across = corner.endsWith('r') ? 180 : 0; // toward the middle horizontally
  const along = corner.startsWith('b') ? (across === 180 ? 270 : -90) : 90; // ...and vertically
  return Array.from({ length: n }, (_, i) => across + ((along - across) * i) / (n - 1));
}

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
  const R = 66; // px from the inner corner to each icon's centre (room for 4 icons on a quarter arc)

  return (
    <>
      {drag && CORNERS.map((c) => <div key={c} className={`pip-zone c-${c} s-${shape} ${drag.near === c ? 'near' : ''}`} aria-hidden />)}
      <div
        ref={ref}
        className={`pip c-${s.corner} s-${shape} ${hidden ? 'hidden' : ''} ${drag ? 'dragging' : ''} ${canMove ? 'movable' : ''}`}
        style={drag ? { left: drag.x, top: drag.y } : undefined}
      >
        <div className="pip-face" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} title={canMove && !hidden ? 'Drag to another corner' : undefined}>
          {off ? <Avatar name={name} /> : <Video stream={stream} mirror={mirror} />}
        </div>

        {canMove && !drag && !hidden && (
          <div className="pip-actions" style={{ '--ix': ix, '--iy': iy } as React.CSSProperties}>
            <span className="pip-bridge" aria-hidden />
            {[...SHAPES.map((x) => ({ ...x, kind: 'shape' as const })), { shape: null, label: 'Hide', icon: <EyeOff size={15} />, kind: 'hide' as const }].map((a, i) => {
              const rad = (angles[i] * Math.PI) / 180;
              return (
                <button
                  key={a.label}
                  className={`pip-act ${a.kind === 'shape' && a.shape === shape ? 'on' : ''}`}
                  style={{ '--dx': `${Math.cos(rad) * R}px`, '--dy': `${Math.sin(rad) * R}px`, '--i': i } as React.CSSProperties}
                  onClick={() => (a.kind === 'hide' ? room.setPip({ hidden: true }) : room.setPip({ shape: a.shape! }))}
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
