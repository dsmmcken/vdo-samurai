import { useEffect, useRef } from 'react';
import type { Room } from '../lib/room';
import type { PeerId } from '../lib/types';
import { drawReactions, fetchLottie, type Sprite } from '../lib/reactions';

/** The player, loaded the first time this client has a reaction to show. */
let player: Promise<Sprite> | null = null;
const loadPlayer = () => (player ??= import('../lib/lottie').then(({ Sprites }) => new Sprites(192, fetchLottie).sprite));

/**
 * Reactions floating over the whole stage, above the ink and the camera
 * overlay: a transparent canvas, redrawn every animation frame with the same
 * drawReactions as the render, but only while something is in the air.
 */
export function Reactions({ room, name }: { room: Room; name: (id: PeerId) => string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  // Read on every frame, so a rename shows without restarting the loop.
  const nameRef = useRef(name);
  nameRef.current = name;

  useEffect(() => {
    const c = ref.current!;
    const ctx = c.getContext('2d')!;
    let raf = 0;
    let sprite: Sprite | null = null;
    let alive = true;
    const tick = () => {
      const dpr = devicePixelRatio || 1;
      const w = Math.round(c.clientWidth * dpr), h = Math.round(c.clientHeight * dpr);
      if (c.width !== w || c.height !== h) (c.width = w), (c.height = h);
      ctx.clearRect(0, 0, w, h);
      const t = performance.timeOrigin + performance.now();
      const live = [...room.liveReactions(t)];
      if (sprite) drawReactions(ctx, live, t, { x: 0, y: 0, w, h }, sprite, (id) => nameRef.current(id));
      raf = live.length ? requestAnimationFrame(tick) : 0;
    };
    const wake = () => {
      loadPlayer().then((s) => {
        if (!alive) return;
        sprite = s;
        // Start fetching new emoji now, not on their first frame.
        for (const r of room.liveReactions()) s(r.cp, 0);
        if (!raf) tick();
      });
    };
    const stop = room.watchReactions(wake);
    if (room.liveReactions().next().done === false) wake();
    return () => {
      alive = false;
      stop();
      cancelAnimationFrame(raf);
    };
  }, [room]);

  return <canvas ref={ref} className="reactions" aria-hidden />;
}
