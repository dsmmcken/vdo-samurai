// Animations: what an animation script declares, and the pure rules around them (no
// browser APIs here, so the sandbox, the room, the render and the tests share it).
//
// An animation is a script that calls samurai.animation({...}) once. It draws every
// frame from scratch as a function of t, so any browser (and the render, frame
// by frame) gets the same picture for the same t.
import type { PeerId, AnimationMicrophones, Slot } from './types';
import { validate, type Schema } from './json-schema';

/** The animation canvas, live and in the final cut. */
export const ANIMATION_W = 1920;
export const ANIMATION_H = 1080;
/** Frames per second, live and in the final cut. */
export const ANIMATION_FPS = 30;
/** Largest script (assets included), in bytes. */
export const ANIMATION_MAX_BYTES = 5 * 1024 * 1024;
export const ANIMATION_MAX_SECONDS = 600;
export const ANIMATION_NAME_MAX = 60;

/**
 * What happens at the end: back to what was on stage before, hold the last
 * frame, loop until someone switches, or the tile N places along the strip
 * (wrapping around).
 */
export type AnimationEnd = 'prev' | 'hold' | 'loop' | { tile: number };

export interface AnimationCue {
  asset: string;
  /** Seconds into the animation (into each pass, for a looping animation). */
  at: number;
  gain: number;
}

/** An animation's declaration, minus draw() and the asset data. */
export interface AnimationMeta {
  name: string;
  duration: number;
  end: AnimationEnd;
  microphones: AnimationMicrophones;
  audio: AnimationCue[];
  /** Asset names by kind. */
  images: string[];
  sounds: string[];
  fonts: string[];
}

const ASSET_KINDS = { image: /^data:image\/(png|jpeg|webp|gif|avif);base64,/, audio: /^data:audio\/(mpeg|mp3|wav|wave|x-wav|ogg|webm|mp4|aac|flac);base64,/, font: /^data:(font\/(ttf|otf|woff|woff2)|application\/(font-woff|x-font-ttf|x-font-otf));base64,/ };

export function assetKind(url: unknown): keyof typeof ASSET_KINDS | null {
  if (typeof url !== 'string') return null;
  for (const [k, re] of Object.entries(ASSET_KINDS)) if (re.test(url)) return k as keyof typeof ASSET_KINDS;
  return null;
}

/**
 * What samurai.animation() takes, as a JSON Schema (draw is checked separately:
 * functions aren't JSON). Unknown properties are refused, so a typo like
 * `durration` is an error, not a silently ignored option.
 */
export const ANIMATION_SCHEMA: Schema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'samurai.animation() declaration',
  type: 'object',
  required: ['name', 'duration', 'draw'],
  additionalProperties: false,
  properties: {
    name: { type: 'string', minLength: 1, maxLength: ANIMATION_NAME_MAX, not: { const: '__proto__' }, description: 'Unique in the room: adding an animation with the same name replaces it.' },
    duration: { type: 'number', exclusiveMinimum: 0, maximum: ANIMATION_MAX_SECONDS, description: 'Seconds.' },
    end: {
      'x-hint': "must be 'prev', 'hold', 'loop' or { tile: N } (N a whole number, not 0: 1 is the next tile, -1 the one before)",
      oneOf: [{ enum: ['prev', 'hold', 'loop'] }, { type: 'object', required: ['tile'], additionalProperties: false, properties: { tile: { type: 'integer', not: { const: 0 } } } }],
    },
    microphones: { enum: ['none', 'director', 'all'] },
    audio: {
      type: 'array',
      items: {
        type: 'object',
        required: ['asset'],
        additionalProperties: false,
        properties: {
          asset: { type: 'string', description: 'The name of an audio asset.' },
          at: { type: 'number', minimum: 0, description: 'Seconds into the animation (into each pass when looping).' },
          gain: { type: 'number', minimum: 0, maximum: 2, description: '1 = as recorded.' },
        },
      },
    },
    draw: { description: 'function draw(ctx, t, animation): paints the frame at t seconds.' },
    assets: {
      type: 'object',
      propertyNames: { pattern: '^[A-Za-z_$][\\w$]*$', not: { const: '__proto__' } },
      additionalProperties: {
        type: 'string',
        pattern: '^(image|audio|font|data:[\\w/+.-]+;base64,[A-Za-z0-9+/=\\s]*)$',
        description: "'image', 'audio' or 'font' (a placeholder: the app asks for the file and puts it in), or a base64 data: URL.",
        'x-hint': 'must be a base64 data: URL of an image (png, jpeg, webp, gif, avif), a sound (mp3, wav, ogg, webm, m4a/aac, flac) or a font (ttf, otf, woff, woff2)',
      },
    },
  },
};

/** Checks what a script passed to samurai.animation(); throws with a message meant for its author. */
export function validateAnimation(d: any): AnimationMeta {
  if (!d || typeof d !== 'object' || Array.isArray(d)) throw new Error('samurai.animation() needs an object: samurai.animation({ name, duration, draw })');
  // Placeholders first: they mean "add the file", not "this is wrong".
  for (const [k, v] of Object.entries(d.assets && typeof d.assets === 'object' ? d.assets : {}))
    if (v === 'image' || v === 'audio' || v === 'font') throw new Error(`assets.${k}: add the ${v === 'audio' ? 'sound' : v} file for it`);
  const errs = validate(ANIMATION_SCHEMA, d);
  if (typeof d.draw !== 'function' && !errs.some((e) => e.path === 'draw')) errs.push({ path: 'draw', message: 'must be a function draw(ctx, t, animation) that paints the frame at t seconds' });
  if (errs.length) throw new Error(errs.slice(0, 4).map((e) => `${e.path || 'animation'}: ${e.message}`).join('\n') + (errs.length > 4 ? `\n…and ${errs.length - 4} more` : ''));
  const name = d.name.trim();
  if (!okName(name)) throw new Error("name: can't be empty");
  const images: string[] = [];
  const sounds: string[] = [];
  const fonts: string[] = [];
  for (const [k, v] of Object.entries((d.assets ?? {}) as Record<string, string>)) {
    const kind = assetKind(v);
    if (!kind) throw new Error(`assets.${k}: must be an image (png, jpeg, webp, gif, avif), a sound (mp3, wav, ogg, webm, m4a/aac, flac) or a font (ttf, otf, woff, woff2)`);
    (kind === 'image' ? images : kind === 'audio' ? sounds : fonts).push(k);
  }
  const audio: AnimationCue[] = ((d.audio ?? []) as any[]).map((c, i) => {
    if (!sounds.includes(c.asset)) throw new Error(`audio[${i}].asset: "${c.asset}" isn't a sound in assets`);
    return { asset: c.asset, at: c.at ?? 0, gain: c.gain ?? 1 };
  });
  const end: AnimationEnd = typeof d.end === 'object' ? { tile: d.end.tile } : (d.end ?? 'prev');
  return { name, duration: d.duration, end, microphones: d.microphones ?? 'director', audio, images, sounds, fonts };
}

/** Animation names key plain objects (and travel between peers): never one that reaches a prototype. */
export const okName = (name: unknown): name is string => typeof name === 'string' && name.length > 0 && name.length <= ANIMATION_NAME_MAX && name !== '__proto__';


/**
 * The t to draw, `elapsed` seconds after the animation started: held on the last
 * frame once it's over (until the ending switches away), or looped.
 */
export function animationTime(meta: Pick<AnimationMeta, 'duration' | 'end'>, elapsed: number) {
  const t = Math.max(0, elapsed);
  if (meta.end === 'loop') return t % meta.duration;
  return Math.min(t, meta.duration);
}

/** The slot an ending of { tile: N } lands on: N places along the strip from the animation's own, wrapping. */
export function tileAfter(strip: Slot[], from: Slot, n: number): Slot | null {
  const i = strip.indexOf(from);
  if (i < 0 || !strip.length) return null;
  const j = (((i + n) % strip.length) + strip.length) % strip.length;
  return j === i ? null : strip[j];
}

const SLOT = 'animation:';
export const animationSlot = (name: string): Slot => `${SLOT}${name}`;
export const slotAnimation = (slot: Slot) => (slot.startsWith(SLOT) ? slot.slice(SLOT.length) : null);

// ------------------------------------------------------------------ the library's registers
//
// Each room keeps a library of animations, by name. Every browser in the room has a
// copy, and copies meet again in later meetings, so each name has two
// last-writer-wins registers stamped with wall-clock time: its content (which
// version, or deleted) and whether it's pinned to the strip. Kept apart, so
// pinning an animation never undoes someone's newer edit to it, or the reverse.

export interface Stamp {
  /** Wall-clock ms, never behind anything this browser has seen (see Clock). */
  ts: number;
  by: PeerId;
}

export interface AnimationContent extends Stamp {
  /** sha-256 of the script (hex); '' once deleted. */
  hash: string;
  size: number;
  deleted: boolean;
}

export interface AnimationPin extends Stamp {
  pinned: boolean;
}

export interface AnimationEntry {
  content: AnimationContent;
  pin?: AnimationPin;
}

/** A room's library: animation name → its registers. Small: scripts are kept apart, by hash. */
export type AnimationIndex = Record<string, AnimationEntry>;

export const newerStamp = (a: Stamp, b: Stamp | undefined) => !b || a.ts > b.ts || (a.ts === b.ts && a.by > b.by);

/**
 * Wall-clock time that never runs backwards and is always past every stamp
 * seen: an edit made after seeing someone else's always wins over it, even if
 * this computer's clock is a little behind theirs.
 */
export class Clock {
  private last = 0;
  seen(ts: number) {
    if (ts > this.last) this.last = ts;
  }
  next(wall = Date.now()) {
    this.last = Math.max(wall, this.last + 1);
    return this.last;
  }
}

function sane(e: any): e is AnimationEntry {
  const c = e?.content;
  if (!c || typeof c.ts !== 'number' || typeof c.by !== 'string' || typeof c.deleted !== 'boolean') return false;
  if (!c.deleted && (typeof c.hash !== 'string' || !/^[0-9a-f]{64}$/.test(c.hash) || typeof c.size !== 'number' || c.size > ANIMATION_MAX_BYTES)) return false;
  const p = e.pin;
  return !p || (typeof p.ts === 'number' && typeof p.by === 'string' && typeof p.pinned === 'boolean');
}

/**
 * Merges `theirs` into `ours` (in place). Returns the names whose content
 * changed (and so may need a script fetched) and every name that changed.
 */
export function mergeIndex(ours: AnimationIndex, theirs: unknown, clock?: Clock): { content: string[]; changed: string[] } {
  const content: string[] = [];
  const changed = new Set<string>();
  if (!theirs || typeof theirs !== 'object') return { content, changed: [] };
  for (const [name, e] of Object.entries(theirs as Record<string, unknown>)) {
    if (!okName(name) || !sane(e)) continue;
    clock?.seen(e.content.ts);
    if (e.pin) clock?.seen(e.pin.ts);
    const mine = Object.hasOwn(ours, name) ? ours[name] : undefined;
    if (!mine) {
      ours[name] = { content: { ...e.content }, ...(e.pin ? { pin: { ...e.pin } } : {}) };
      content.push(name);
      changed.add(name);
      continue;
    }
    if (newerStamp(e.content, mine.content)) {
      mine.content = { ...e.content };
      content.push(name);
      changed.add(name);
    }
    if (e.pin && newerStamp(e.pin, mine.pin)) {
      mine.pin = { ...e.pin };
      changed.add(name);
    }
  }
  return { content, changed: [...changed] };
}

/** Live animations, in name order. */
export const liveAnimations = (idx: AnimationIndex) =>
  Object.entries(idx)
    .filter(([, e]) => !e.content.deleted)
    .sort(([a], [b]) => a.localeCompare(b));

/** Pinned live animations, in the order they were pinned (they start out next to Multicam). */
export const pinnedAnimations = (idx: AnimationIndex) =>
  liveAnimations(idx)
    .filter(([, e]) => e.pin?.pinned)
    .sort(([, a], [, b]) => a.pin!.ts - b.pin!.ts)
    .map(([name, e]) => ({ name, hash: e.content.hash }));

/**
 * A new strip order (what's showing) merged into the old one: slots not showing
 * now (people who left, tiles turned off) stay where they were, after the slot
 * they followed, so they come back to the same place.
 */
export function keepAbsent(next: Slot[], prev: Slot[]): Slot[] {
  const out = [...next];
  prev.forEach((x, i) => {
    if (out.includes(x)) return;
    let j = i - 1;
    while (j >= 0 && !out.includes(prev[j])) j--;
    out.splice(j < 0 ? 0 : out.indexOf(prev[j]) + 1, 0, x);
  });
  return out;
}

/**
 * The strip: everyone's tiles plus Multicam and the pinned animations. Each of
 * those extras sits after as many tiles as it followed when it was last
 * placed; placed last (or never placed) it stays last, after newcomers.
 * Never-placed extras go at the end: Multicam first, then animations as pinned.
 */
export function buildStrip(tiles: PeerId[], order: Slot[], extras: Slot[]): Slot[] {
  const placed: { s: Slot; n: number }[] = [];
  const loose: Slot[] = [];
  for (const s of extras) {
    const at = order.indexOf(s);
    if (at < 0) loose.push(s);
    else if (!order.slice(at + 1).some((id) => tiles.includes(id))) placed.push({ s, n: Infinity });
    else placed.push({ s, n: order.slice(0, at).filter((id) => tiles.includes(id)).length });
  }
  // Same n: as they were in the order.
  placed.sort((a, b) => a.n - b.n || order.indexOf(a.s) - order.indexOf(b.s));
  const out: Slot[] = [];
  let k = 0;
  for (let i = 0; i <= tiles.length; i++) {
    while (k < placed.length && placed[k].n <= i) out.push(placed[k++].s);
    if (i < tiles.length) out.push(tiles[i]);
  }
  while (k < placed.length) out.push(placed[k++].s);
  // Multicam first among the never-placed (so the default is the familiar one).
  return [...out, ...loose.filter((s) => s === 'end'), ...loose.filter((s) => s !== 'end')];
}
