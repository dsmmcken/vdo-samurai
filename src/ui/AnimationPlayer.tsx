import { useEffect, useRef, useState } from 'react';
import { ANIMATION_FPS, ANIMATION_H, ANIMATION_W, type AnimationMeta } from '../lib/animation-api';
import { AnimationSandbox } from '../lib/animation-sandbox';
import { AnimationAudio } from '../lib/animation-player';
import { now } from '../lib/util';
import { Pause, Play, Replay } from './icons';

/** Seconds as 0:01.2. */
const fmt = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;
/** Controls hide this long after the pointer stops moving (while playing). */
const IDLE_MS = 2200;

/**
 * A private preview with player controls: click to play or pause (the action
 * flashes in the middle and fades, like YouTube), a bar at the bottom with
 * play/pause, a scrubber and the time, which fades when the pointer leaves or
 * stops. One sandbox, driven frame by frame; sound restarts from wherever
 * play resumes. Space / K play and pause, ← → jump a second, Home goes to 0.
 */
export function AnimationPlayer({ code, meta, speaker }: { code: string; meta: AnimationMeta; speaker: string | null }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const sandbox = useRef<{ sb: AnimationSandbox; sounds: Record<string, ArrayBuffer> } | null>(null);
  const audio = useRef<AnimationAudio | null>(null);
  /** Where playback is: `from` seconds at local time `at` (when playing). */
  const clock = useRef({ from: 0, at: 0, playing: false });
  const [pos, setPos] = useState(meta.duration * 0.7); // the poster, until first played
  const [playing, setPlaying] = useState(false);
  const [started, setStarted] = useState(false);
  const [ended, setEnded] = useState(false);
  const [flash, setFlash] = useState<{ key: number; play: boolean } | null>(null);
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const idle = useRef<ReturnType<typeof setTimeout> | null>(null);

  // One sandbox for this version of the script, for as long as the player is open.
  useEffect(() => {
    let gone = false;
    AnimationSandbox.open(code).then(
      ({ sandbox: sb, sounds }) => {
        if (gone) return sb.close();
        sandbox.current = { sb, sounds };
        draw(clock.current.from || meta.duration * 0.7);
      },
      (e) => !gone && setError((e as Error).message),
    );
    return () => {
      gone = true;
      sandbox.current?.sb.close();
      sandbox.current = null;
      audio.current?.stop();
    };
  }, [code]);

  // Frames: one in flight at a time; the latest wanted one wins.
  const want = useRef<number | null>(null);
  const busy = useRef(false);
  const draw = (t: number) => {
    want.current = Math.floor(Math.min(t, meta.duration) * ANIMATION_FPS) / ANIMATION_FPS;
    pump();
  };
  const pump = async () => {
    const s = sandbox.current;
    if (busy.current || !s || want.current === null) return;
    const t = want.current;
    want.current = null;
    busy.current = true;
    try {
      const bm = await s.sb.bitmap(t);
      canvas.current?.getContext('bitmaprenderer')?.transferFromImageBitmap(bm);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      busy.current = false;
      if (want.current !== null) pump();
    }
  };

  // Playing: follow the clock.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      const c = clock.current;
      let t = c.from + (now() - c.at) / 1000;
      if (t >= meta.duration) {
        if (meta.end === 'loop') t %= meta.duration;
        else {
          stop(meta.duration);
          setEnded(true);
          return;
        }
      }
      setPos(t);
      draw(t);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const start = (from: number) => {
    const s = sandbox.current;
    if (!s) return;
    clock.current = { from, at: now(), playing: true };
    audio.current?.stop();
    audio.current = null;
    if (meta.audio.length) {
      audio.current = new AnimationAudio(meta, s.sounds, now() - from * 1000, speaker);
      audio.current.start().catch(() => {});
    }
    setStarted(true);
    setEnded(false);
    setPlaying(true);
  };
  const stop = (at: number) => {
    clock.current = { from: at, at: now(), playing: false };
    audio.current?.stop();
    audio.current = null;
    setPlaying(false);
    setPos(at);
    draw(at);
  };
  const current = () => (clock.current.playing ? clock.current.from + (now() - clock.current.at) / 1000 : pos);
  const toggle = (show = true) => {
    const go = !playing;
    if (go) start(ended || !started ? 0 : current());
    else stop(current());
    if (show) setFlash({ key: Date.now(), play: go });
    wake();
  };
  const seek = (t: number) => {
    t = Math.max(0, Math.min(meta.duration, t));
    setStarted(true);
    setEnded(t >= meta.duration && meta.end !== 'loop');
    if (playing) start(t);
    else stop(t);
  };

  /** The pointer moved: show the controls, and hide them again once it's still. */
  const wake = () => {
    setActive(true);
    if (idle.current) clearTimeout(idle.current);
    idle.current = setTimeout(() => setActive(false), IDLE_MS);
  };
  useEffect(() => () => void (idle.current && clearTimeout(idle.current)), []);
  const showBar = started && (active || !playing);

  return (
    <div
      ref={box}
      className={`player ${showBar ? 'show' : ''} ${playing && !active ? 'idle' : ''}`}
      tabIndex={0}
      aria-label="Preview (only you see and hear it)"
      onMouseMove={wake}
      onMouseLeave={() => setActive(false)}
      onKeyDown={(e) => {
        if (e.key === ' ' || e.key === 'k') (e.preventDefault(), toggle());
        else if (e.key === 'ArrowLeft') (e.preventDefault(), seek(current() - 1), wake());
        else if (e.key === 'ArrowRight') (e.preventDefault(), seek(current() + 1), wake());
        else if (e.key === 'Home') (e.preventDefault(), seek(0), wake());
      }}
    >
      <canvas ref={canvas} width={ANIMATION_W} height={ANIMATION_H} onClick={() => toggle()} />
      {flash && (
        <div key={flash.key} className="player-flash" aria-hidden onAnimationEnd={() => setFlash(null)}>
          {flash.play ? <Play size={30} /> : <Pause size={30} />}
        </div>
      )}
      {(!started || ended) && !error && (
        <button className="player-big" onClick={() => toggle(false)} aria-label={ended ? 'Play again' : 'Play preview'} title="Preview: only you see and hear it">
          {ended ? <Replay size={26} /> : <Play size={28} />}
        </button>
      )}
      {error && <div className="animation-note bad">Animation stopped: {error}</div>}
      <div className="player-bar" onMouseMove={wake}>
        <button className="player-btn" onClick={() => toggle(false)} aria-label={playing ? 'Pause' : 'Play'}>
          {playing ? <Pause size={18} /> : ended ? <Replay size={18} /> : <Play size={18} />}
        </button>
        <input
          className="player-seek"
          type="range"
          min={0}
          max={meta.duration}
          step={1 / ANIMATION_FPS}
          value={started ? pos : 0}
          onChange={(e) => seek(Number(e.target.value))}
          aria-label="Position"
          style={{ '--p': `${((started ? pos : 0) / meta.duration) * 100}%` } as React.CSSProperties}
        />
        <span className="player-time">
          {fmt(started ? pos : 0)} / {fmt(meta.duration)}
        </span>
      </div>
    </div>
  );
}
