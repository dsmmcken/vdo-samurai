import { useEffect, useRef, useState } from 'react';
import type { Room, Snapshot } from '../lib/room';
import type { Corner } from '../lib/types';
import { Avatar } from './Avatar';
import { Video } from './Video';

const CORNERS: Corner[] = ['tl', 'tr', 'bl', 'br'];

/**
 * The presenter's camera over a shared screen. Drag it toward any corner: drop
 * zones appear, the nearest lights up, and on release it glides there for
 * everyone (and in the final cut). Anyone can move it before a take; during a
 * take, only the director.
 */
export function Pip({ room, s, stream, mirror, off, name }: { room: Room; s: Snapshot; stream: MediaStream | null; mirror: boolean; off: boolean; name: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ x: number; y: number; dx: number; dy: number; near: Corner } | null>(null);
  const canMove = !s.recording || s.director === s.me;
  // Glide only when the overlay moves to another corner (or snaps after a
  // drop). Without this, resizing the window animates it too, because its
  // position is in units of the stage's size.
  const [gliding, setGliding] = useState(false);
  const glideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const glide = () => {
    setGliding(true);
    if (glideTimer.current) clearTimeout(glideTimer.current);
    glideTimer.current = setTimeout(() => setGliding(false), 500);
  };
  const lastCorner = useRef(s.corner);
  useEffect(() => {
    if (lastCorner.current !== s.corner) glide();
    lastCorner.current = s.corner;
  }, [s.corner]);
  useEffect(() => () => void (glideTimer.current && clearTimeout(glideTimer.current)), []);

  const nearest = (cx: number, cy: number, frame: DOMRect): Corner =>
    `${cy < frame.top + frame.height / 2 ? 't' : 'b'}${cx < frame.left + frame.width / 2 ? 'l' : 'r'}` as Corner;

  const onDown = (e: React.PointerEvent) => {
    if (!canMove || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const frame = ref.current.parentElement!.getBoundingClientRect();
    ref.current.setPointerCapture(e.pointerId);
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
    glide(); // snap from wherever it was dropped
    room.setCorner(drag.near);
    setDrag(null);
  };

  return (
    <>
      {drag &&
        CORNERS.map((c) => <div key={c} className={`pip-zone c-${c} ${drag.near === c ? 'near' : ''}`} aria-hidden />)}
      <div
        ref={ref}
        className={`pip c-${s.corner} ${drag ? 'dragging' : ''} ${gliding ? 'gliding' : ''} ${canMove ? 'movable' : ''}`}
        style={drag ? { left: drag.x, top: drag.y } : undefined}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        title={canMove ? 'Drag to another corner' : undefined}
      >
        {off ? <Avatar name={name} /> : <Video stream={stream} mirror={mirror} />}
      </div>
    </>
  );
}
