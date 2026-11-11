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
  // Dims for everyone as soon as Record is pressed, with "Get ready" until
  // the numbers start (the recorders spin up meanwhile); it leaves as 3 arrives.
  return (
    <div className="countdown" aria-live="assertive">
      <span className={`get-ready ${label ? 'out' : ''}`} aria-hidden={!!label}>
        <span className="get">Get </span>ready
      </span>
      {label && (
        <span key={label} className="count">
          {label}
        </span>
      )}
    </div>
  );
}
