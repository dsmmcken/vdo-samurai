// Plays an animation live: on the stage for everyone (t from the shared start time),
// or as a private preview. Frames are drawn in the sandbox at 30 fps, the same
// frames the final cut gets; sound is scheduled with Web Audio against the same
// clock, so it lines up with the picture on every computer.
import { ANIMATION_FPS, ANIMATION_H, ANIMATION_W, animationTime, type AnimationMeta } from './animation-api';
import { AnimationSandbox } from './animation-sandbox';
import { now } from './util';

/** How far ahead looping sound is scheduled. */
const AHEAD_S = 2;
const FADE_S = 0.05;

export interface PlayOptions {
  code: string;
  /** When t = 0, on our clock (util.now()). */
  startLocal: number;
  canvas: HTMLCanvasElement;
  speaker?: string | null;
  /** The script failed while playing. */
  onError?: (message: string) => void;
  /** Just this frame (seconds), silent: a poster. */
  still?: number;
}

/** Starts playing; the returned function stops it (and its sound). */
export function playAnimation(o: PlayOptions): () => void {
  let stopped = false;
  let sandbox: AnimationSandbox | null = null;
  let raf = 0;
  let audio: AnimationAudio | null = null;
  const stop = () => {
    stopped = true;
    cancelAnimationFrame(raf);
    sandbox?.close();
    audio?.stop();
  };
  (async () => {
    const loaded = await AnimationSandbox.open(o.code);
    if (stopped) return loaded.sandbox.close();
    sandbox = loaded.sandbox;
    const meta = loaded.meta;
    // Frames arrive as pictures and go on screen without a copy. Full size, unless
    // shown at half size or less (scaling costs more than it saves above that).
    const view = o.canvas.getContext('bitmaprenderer')!;
    const size = () => {
      const w = Math.max(160, Math.round(o.canvas.clientWidth * devicePixelRatio));
      return w > ANIMATION_W / 2 ? ([ANIMATION_W, ANIMATION_H] as const) : ([w, Math.round((w * ANIMATION_H) / ANIMATION_W)] as const);
    };
    const show = async (t: number) => {
      const bm = await sandbox!.bitmap(t, ...size());
      if (stopped) return bm.close();
      view.transferFromImageBitmap(bm);
    };
    if (o.still !== undefined) {
      await show(animationTime(meta, o.still));
      sandbox.close(); // a poster needs nothing more
      return;
    }
    if (meta.audio.length) {
      audio = new AnimationAudio(meta, loaded.sounds, o.startLocal, o.speaker ?? null);
      audio.start().catch((e) => console.warn('[animation] sound failed', e));
    }
    let busy = false;
    let lastFrame = -1;
    const tick = () => {
      if (stopped) return;
      raf = requestAnimationFrame(tick);
      const elapsed = (now() - o.startLocal) / 1000;
      // Whole frames only, the same ones the final cut draws.
      const k = Math.floor(animationTime(meta, elapsed) * ANIMATION_FPS);
      if (busy || k === lastFrame) return;
      busy = true;
      lastFrame = k;
      show(k / ANIMATION_FPS)
        .catch((e) => {
          if (stopped) return;
          stopped = true;
          o.onError?.((e as Error).message);
        })
        .finally(() => (busy = false));
    };
    tick();
  })().catch((e) => !stopped && o.onError?.((e as Error).message));
  return stop;
}

/** An animation's sound cues, on Web Audio, at times derived from the shared clock. */
export class AnimationAudio {
  private ctx: AudioContext;
  private out: GainNode;
  private buffers = new Map<string, AudioBuffer>();
  private playing: AudioBufferSourceNode[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  /** Looping: passes already scheduled. */
  private scheduled = new Set<number>();

  constructor(
    private meta: AnimationMeta,
    private sounds: Record<string, ArrayBuffer>,
    private startLocal: number,
    speaker: string | null,
  ) {
    this.ctx = new AudioContext({ latencyHint: 'playback' });
    if (speaker && 'setSinkId' in this.ctx) (this.ctx as any).setSinkId(speaker).catch(() => {});
    this.out = this.ctx.createGain();
    this.out.connect(this.ctx.destination);
  }

  async start() {
    await this.ctx.resume().catch(() => {});
    for (const name of new Set(this.meta.audio.map((c) => c.asset))) {
      try {
        this.buffers.set(name, await this.ctx.decodeAudioData(this.sounds[name].slice(0)));
      } catch (e) {
        console.warn('[animation] could not decode', name, e);
      }
    }
    if (this.ctx.state === 'closed') return;
    this.schedule();
    if (this.meta.end === 'loop') this.timer = setInterval(() => this.schedule(), 500);
  }

  /** Animation seconds → this context's time. */
  private ctxTime(t: number) {
    return this.ctx.currentTime + (this.startLocal + t * 1000 - now()) / 1000;
  }

  private schedule() {
    const passes: number[] = [];
    if (this.meta.end === 'loop') {
      const elapsed = (now() - this.startLocal) / 1000;
      const first = Math.max(0, Math.floor(elapsed / this.meta.duration));
      for (let k = first; k * this.meta.duration < elapsed + AHEAD_S; k++) passes.push(k);
    } else passes.push(0);
    for (const k of passes) {
      if (this.scheduled.has(k)) continue;
      this.scheduled.add(k);
      const base = k * this.meta.duration;
      for (const cue of this.meta.audio) {
        const buf = this.buffers.get(cue.asset);
        if (!buf) continue;
        const when = this.ctxTime(base + cue.at);
        const late = Math.max(0, this.ctx.currentTime - when);
        if (late >= buf.duration) continue;
        const src = this.ctx.createBufferSource();
        src.buffer = buf;
        const g = this.ctx.createGain();
        g.gain.value = cue.gain;
        src.connect(g).connect(this.out);
        src.start(when + late, late);
        // A looping animation's sound stops where its pass ends, as in the final cut.
        if (this.meta.end === 'loop') src.stop(this.ctxTime(base + this.meta.duration));
        src.onended = () => (this.playing = this.playing.filter((p) => p !== src));
        this.playing.push(src);
      }
    }
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    const t = this.ctx.currentTime;
    this.out.gain.setValueAtTime(this.out.gain.value, t);
    this.out.gain.linearRampToValueAtTime(0, t + FADE_S);
    setTimeout(() => this.ctx.close().catch(() => {}), FADE_S * 1000 + 50);
  }
}
