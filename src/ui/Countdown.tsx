import { useEffect, useState } from 'react';
import { COUNTDOWN_MS } from '../lib/room';

/** 3-2-1 overlay, driven by the shared start instant (already on our clock). */
export function Countdown({ startLocal }: { startLocal: number | null }) {
  const [label, setLabel] = useState<string | null>(null);
  useEffect(() => {
    if (startLocal === null) return setLabel(null);
    let raf = 0;
    const tick = () => {
      const left = startLocal - (performance.timeOrigin + performance.now());
      if (left > COUNTDOWN_MS) setLabel('');
      else if (left > 0) setLabel(String(Math.ceil(left / 1000)));
      else return setLabel(null); // recording from here; no extra beat
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [startLocal]);
  if (label === null) return null;
  // Dims for everyone as soon as Record is pressed; the numbers follow.
  return (
    <div className="countdown" aria-live="assertive">
      {label && <span key={label}>{label}</span>}
    </div>
  );
}
