// The host side of an animation sandbox: load a script, then ask for frames. The
// script runs in a worker inside the null-origin sandbox frame (animation-host.ts);
// we talk to it over a MessagePort. Works on the page (live stage, preview,
// checking a new script) and in the render worker, which has the page start
// its sandboxes (useSpawn). A script that hangs is cut off: loading gets
// LOAD_MS, each frame FRAME_MS, then its worker is terminated.
import { validateAnimation, type AnimationMeta } from './animation-api';
import { spawnInFrame, type Spawn } from './animation-host';

const LOAD_MS = 15_000;
const FRAME_MS = 3000;

export interface LoadedAnimation {
  sandbox: AnimationSandbox;
  meta: AnimationMeta;
  /** Each audio asset's file bytes, to decode where it plays. */
  sounds: Record<string, ArrayBuffer>;
}

/** How sandboxes are started here: the frame on a page; set by a worker that can't make one. */
let spawn: Spawn | null = typeof document !== 'undefined' ? spawnInFrame : null;
export function useSpawn(s: Spawn) {
  spawn = s;
}

export class AnimationSandbox {
  private port: MessagePort;
  private kill: Promise<() => void>;
  private nextId = 1;
  private waiting = new Map<number, { res: (v: any) => void; rej: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private onLoad: { res: (v: any) => void; rej: (e: Error) => void } | null = null;
  /** Why it stopped working, once it has. */
  broken: string | null = null;

  private constructor() {
    if (!spawn) throw new Error('Animations need a page to run in.');
    const ch = new MessageChannel();
    this.port = ch.port1;
    this.port.onmessage = (e) => this.receive(e.data);
    this.kill = spawn(ch.port2, (message) => this.fail(message));
    this.kill.catch((e) => this.fail((e as Error).message));
  }

  /** Loads and checks a script; rejects with a message for its author. */
  static async open(code: string): Promise<LoadedAnimation> {
    const sb = new AnimationSandbox();
    try {
      const r = await new Promise<{ meta: AnimationMeta; sounds: Record<string, ArrayBuffer> }>((res, rej) => {
        const timer = setTimeout(() => rej(new Error(`The script took more than ${LOAD_MS / 1000} s to load (an endless loop?).`)), LOAD_MS);
        sb.onLoad = { res: (v) => (clearTimeout(timer), res(v)), rej: (e) => (clearTimeout(timer), rej(e)) };
        sb.port.postMessage({ t: 'load', code });
      });
      return { sandbox: sb, ...r };
    } catch (e) {
      sb.close();
      throw e;
    }
  }

  /** Checks a script without keeping it running. */
  static async check(code: string) {
    const { sandbox, meta } = await AnimationSandbox.open(code);
    sandbox.close();
    return meta;
  }

  private receive(m: any) {
    if (m?.t === 'loaded') {
      // What the script declared is checked here, against the schema: never trusted from inside.
      try {
        const meta = validateAnimation({ ...(m.decl ?? {}), draw: m.hasDraw ? () => {} : undefined });
        const sounds: Record<string, ArrayBuffer> = {};
        for (const n of meta.sounds) if (m.sounds?.[n] instanceof ArrayBuffer) sounds[n] = m.sounds[n];
        return this.onLoad?.res({ meta, sounds });
      } catch (e) {
        return this.onLoad?.rej(e as Error);
      }
    }
    if (m?.t === 'error' && m.id === undefined) return this.onLoad?.rej(new Error(String(m.message)));
    const w = typeof m?.id === 'number' ? this.waiting.get(m.id) : undefined;
    if (!w) return;
    this.waiting.delete(m.id);
    clearTimeout(w.timer);
    if (m.t === 'error') w.rej(new Error(String(m.message)));
    else w.res(m.bitmap ?? null);
  }

  private fail(why: string) {
    if (this.broken) return;
    this.broken = why;
    this.onLoad?.rej(new Error(why));
    for (const w of this.waiting.values()) {
      clearTimeout(w.timer);
      w.rej(new Error(why));
    }
    this.waiting.clear();
    this.port.close();
    this.kill.then((k) => k(), () => {});
  }

  private ask(at: number, w?: number, h?: number): Promise<ImageBitmap | null> {
    if (this.broken) return Promise.reject(new Error(this.broken));
    const id = this.nextId++;
    return new Promise((res, rej) => {
      const timer = setTimeout(() => this.fail(`a frame took more than ${FRAME_MS / 1000} s to draw (an endless loop?)`), FRAME_MS);
      this.waiting.set(id, { res, rej, timer });
      this.port.postMessage({ t: 'frame', id, at, w, h });
    });
  }

  /** The frame at `at` seconds, as a picture: 1920×1080, or scaled to w × h. */
  async bitmap(at: number, w?: number, h?: number) {
    return (await this.ask(at, w, h))!;
  }

  close() {
    this.fail('closed');
  }
}
