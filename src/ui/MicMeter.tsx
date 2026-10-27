import { useEffect, useRef } from 'react';
import { levelDb } from '../lib/levels';

/**
 * A thin level bar along the bottom of a tile, like a classic audio meter: the
 * color depends on how far it reaches. Updates the DOM directly, not React state.
 */
export function MicMeter({ stream }: { stream: MediaStream | null }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!stream) return;
    let raf = 0;
    let shown = -1;
    let smooth = -100;
    let last = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (now - last < 50) return; // 20 updates a second is plenty
      last = now;
      const db = levelDb(stream);
      smooth = db > smooth ? db : smooth - 1.5; // fast attack, ~30 dB/s release
      const l = Math.max(0, Math.min(1, (smooth + 60) / 60)); // −60 dBFS … 0 dBFS
      const rounded = Math.round(l * 100) / 100;
      if (rounded !== shown && ref.current) {
        ref.current.style.setProperty('--l', String(rounded));
        shown = rounded;
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [stream]);
  return (
    <span ref={ref} className="meter" aria-hidden />
  );
}
