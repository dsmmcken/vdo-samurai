import { useEffect, useRef } from 'react';
import type { Room } from '../lib/room';
import { drawInk, fitContain, PLAYBACK_MS, type InkStroke } from '../lib/ink';
import type { PeerId } from '../lib/types';

/**
 * Ink over the screen on stage: a transparent canvas, redrawn every animation
 * frame with the same drawInk as the render. It sits under the camera overlay
 * and the controls, and only takes the pointer while the pen is on.
 */
export function Ink({ room, pen, name }: { room: Room; pen: boolean; name: (id: PeerId) => string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const names = useRef(name);
  names.current = name;
  /** The shared picture inside the stage (the letterboxed video content), in CSS px. */
  const picture = () => {
    const c = ref.current!;
    const v = c.parentElement?.querySelector<HTMLVideoElement>('video.stage-video');
    return fitContain(v?.videoWidth || 16, v?.videoHeight || 9, c.clientWidth, c.clientHeight);
  };

  useEffect(() => {
    const c = ref.current!;
    const ctx = c.getContext('2d')!;
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const dpr = devicePixelRatio || 1;
      const w = Math.round(c.clientWidth * dpr), h = Math.round(c.clientHeight * dpr);
      if (c.width !== w || c.height !== h) (c.width = w), (c.height = h);
      ctx.clearRect(0, 0, w, h);
      const r = picture();
      const rect = { x: r.x * dpr, y: r.y * dpr, w: r.w * dpr, h: r.h * dpr };
      const t = performance.timeOrigin + performance.now();
      const mine: InkStroke[] = [], theirs: InkStroke[] = [];
      for (const s of room.liveInk()) (s.by === room.me ? mine : theirs).push(s);
      // Ours as we draw it; everyone else's a moment behind, played back smoothly.
      const labels = { name: (id: PeerId) => names.current(id), self: room.me };
      drawInk(ctx, theirs, t - PLAYBACK_MS, rect, labels);
      drawInk(ctx, mine, t, rect);
    };
    tick();
    return () => {
      cancelAnimationFrame(raf);
      room.penUp();
    };
  }, [room]);
  useEffect(() => {
    if (!pen) room.penUp();
  }, [pen]);

  const at = (e: { clientX: number; clientY: number; pointerType: string; pressure: number }): [number, number, number?] => {
    const b = ref.current!.getBoundingClientRect();
    const r = picture();
    const clamp = (v: number) => Math.max(0, Math.min(1, v));
    // Only a stylus reports real pressure; the rest get it from their speed.
    return [clamp((e.clientX - b.left - r.x) / r.w), clamp((e.clientY - b.top - r.y) / r.h), e.pointerType === 'pen' ? e.pressure : undefined];
  };
  return (
    <canvas
      ref={ref}
      className={`ink ${pen ? 'pen' : ''}`}
      onPointerDown={(e) => {
        if (!pen || e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        room.penDown(...at(e));
      }}
      onPointerMove={(e) => {
        if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
        const all = e.nativeEvent.getCoalescedEvents?.();
        for (const p of all?.length ? all : [e]) room.penMove(...at(p));
      }}
      onPointerUp={() => room.penUp()}
      onPointerCancel={() => room.penUp()}
    />
  );
}
