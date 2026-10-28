// Emoji reactions floating up the stage. One pure function draws every
// reaction in flight at a moment in time; the live overlay (ui/Reactions.tsx)
// calls it every animation frame and the render worker for every output frame,
// so the final cut shows what people saw. Each flight (where it starts, how it
// sways, how fast it rises, how big it is) comes from a seed in the message.
// No DOM and no player in here: the animated emoji come in as `sprite`.
import type { Rect } from './ink';
import type { PeerId } from './types';

export const FLIGHT_MS = 3600;
/** More than this in the air at once and the oldest drop out. */
export const MAX_REACTIONS = 20;

export interface Reaction {
  id: string;
  by: PeerId;
  /** Noto codepoint, like 1f389 or 1f44d_1f3fd. */
  cp: string;
  /** When it was sent: our own clock live, take time in the log. */
  at: number;
  seed: number;
}

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
/** The animated emoji `cp`, `ms` into its loop, as a square image; null while it loads. */
export type Sprite = (cp: string, ms: number) => CanvasImageSource | null;

/** mulberry32: the same numbers from the same seed, everywhere. */
function random(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Where a reaction is, as fractions of the stage (x, y of its centre; size of its height), or null when it isn't in the air. */
export function flight(r: Reaction, t: number) {
  const rnd = random(r.seed);
  const x0 = 0.1 + rnd() * 0.8;
  const dur = FLIGHT_MS * (0.85 + rnd() * 0.15);
  const size = 0.075 + rnd() * 0.035;
  const sway = (0.015 + rnd() * 0.02) * (rnd() < 0.5 ? -1 : 1);
  const turns = 1.2 + rnd() * 0.8;
  const phase = rnd() * Math.PI * 2;
  const top = 0.12 + rnd() * 0.12;
  const k = (t - r.at) / dur;
  if (k < 0 || k >= 1) return null;
  // Rises fast, then slows near the top; pops in, sways side to side, fades out.
  const rise = 1 - (1 - k) ** 1.6;
  const y = 1 + size / 2 - rise * (1 + size / 2 - top);
  const x = x0 + sway * (Math.sin(phase + k * turns * Math.PI * 2) - Math.sin(phase));
  const pop = k < 0.06 ? 0.5 + 0.5 * Math.sin((k / 0.06) * Math.PI * 0.6) / Math.sin(Math.PI * 0.6) : 1;
  const alpha = k < 0.03 ? k / 0.03 : k > 0.7 ? Math.max(0, 1 - (k - 0.7) / 0.3) : 1;
  return { x, y, size: size * pop, alpha, tilt: sway * 4 * Math.cos(phase + k * turns * Math.PI * 2) };
}

/** The reactions to show at `t`: in flight, the newest MAX_REACTIONS. */
export function inFlight(list: Iterable<Reaction>, t: number) {
  const out = [...list].filter((r) => t >= r.at && t < r.at + FLIGHT_MS);
  out.sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1));
  return out.slice(-MAX_REACTIONS);
}

/** Draws every reaction in flight at time `t` over `rect` (the whole stage). */
export function drawReactions(ctx: Ctx, list: Iterable<Reaction>, t: number, rect: Rect, sprite: Sprite) {
  for (const r of inFlight(list, t)) {
    const f = flight(r, t);
    const img = f && sprite(r.cp, t - r.at);
    if (!f || !img) continue;
    const s = f.size * rect.h;
    ctx.save();
    ctx.globalAlpha = f.alpha;
    ctx.translate(rect.x + f.x * rect.w, rect.y + f.y * rect.h);
    ctx.rotate(f.tilt);
    ctx.drawImage(img, -s / 2, -s / 2, s, s);
    ctx.restore();
  }
}

export const lottieUrl = (cp: string) => `https://fonts.gstatic.com/s/e/notoemoji/latest/${cp}/lottie.json`;

const files = new Map<string, Promise<string>>();
/** An emoji's Lottie file from Google, once per session (it's cached there for two days too). */
export function fetchLottie(cp: string) {
  let p = files.get(cp);
  if (!p) {
    files.set(cp, (p = fetch(lottieUrl(cp)).then((r) => (r.ok ? r.text() : Promise.reject(new Error(`${cp}: ${r.status}`))))));
    p.catch(() => files.delete(cp)); // try again next time
  }
  return p;
}
