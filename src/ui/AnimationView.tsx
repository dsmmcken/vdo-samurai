import { useEffect, useRef, useState } from 'react';
import { playAnimation } from '../lib/animation-player';
import { ANIMATION_H, ANIMATION_W } from '../lib/animation-api';

/**
 * An animation playing on a 1920×1080 canvas scaled to fit. `startLocal` is t = 0
 * on our clock: the shared start for the stage, or now for a preview. Key it
 * per play: a canvas can be handed to a worker only once.
 */
export function AnimationView({ load, startLocal, speaker, className, still }: { load: () => Promise<string | null>; startLocal: number; speaker?: string | null; className?: string; still?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    let stop: (() => void) | null = null;
    let gone = false;
    setError(null);
    setMissing(false);
    // A script still on its way (someone joined mid-animation): look again each second.
    const attempt = () =>
      load().then((code) => {
        if (gone) return;
        if (code === null) {
          setMissing(true);
          setTimeout(attempt, 1000);
          return;
        }
        setMissing(false);
        stop = playAnimation({ code, startLocal, canvas: ref.current!, speaker, onError: setError, still });
      });
    attempt();
    return () => {
      gone = true;
      stop?.();
    };
    // Once per mount: the caller keys this by animation version and start, so a
    // clock estimate that's refined meanwhile doesn't restart the animation.
  }, []);
  return (
    <div className={`animation-view ${className ?? ''}`}>
      <canvas ref={ref} width={ANIMATION_W} height={ANIMATION_H} />
      {missing && <div className="animation-note">Getting this animation…</div>}
      {error && <div className="animation-note bad">Animation stopped: {error}</div>}
    </div>
  );
}
