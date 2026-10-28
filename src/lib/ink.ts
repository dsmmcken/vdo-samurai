// Drawing on a shared screen (like a Slack huddle). One pure function draws the
// ink for a moment in time; the live overlay (ui/Ink.tsx) calls it every
// animation frame and the render worker for every output frame, so the final
// cut shows exactly what people saw. No DOM in here: it runs in the worker too.
//
// Points are fractions of the shared picture (the letterboxed video content,
// not the element), so a line lands on the same spot for every window size
// and wherever the render places the screen.
import { getStroke } from 'perfect-freehand';
import type { PeerId } from './types';

/** Ink stays solid this long after the pen lifts, then fades out over FADE_MS. */
export const HOLD_MS = 2000;
export const FADE_MS = 1000;
/**
 * Other people's ink plays back this far behind, on the times it was drawn:
 * points arrive in 50 ms batches, and the delay lets the line and its pencil
 * move smoothly through each batch instead of jumping from one to the next.
 */
export const PLAYBACK_MS = 200;
/** The pencil stays at the end of a finished stroke this long, fading over the last CURSOR_FADE_MS. */
const CURSOR_MS = 700;
const CURSOR_FADE_MS = 300;

export interface InkStroke {
  by: PeerId;
  /** Colour slot in INK_COLORS. */
  c?: number;
  /**
   * [x, y, t, pressure?]: x, y across the shared picture (0..1); t in ms (our
   * own clock live, take time in the log); pressure (0..1) only from a stylus.
   */
  pts: InkPoint[];
  /** When the pen lifted, same clock; absent while drawing. */
  up?: number;
}

export type InkPoint = [number, number, number, number?];

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

// Bright enough to read on any screen, and none of them the lower third's blue.
export const INK_COLORS = ['#ff3b5c', '#ff9f1c', '#ffd60a', '#2ee66b', '#22d3ee', '#4f7cff', '#b45cff', '#ff5cc8'];

/** A stroke's colour: the slot its author held, unique in the room (Room.claimInk). */
export function inkColor(s: { by: PeerId; c?: number }) {
  if (s.c !== undefined) return INK_COLORS[s.c % INK_COLORS.length];
  let h = 0; // logged before strokes carried a slot
  for (const ch of s.by) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return INK_COLORS[h % INK_COLORS.length];
}

/** Where a sw x sh picture sits when fitted ("contain") into a w x h box. */
export function fitContain(sw: number, sh: number, w: number, h: number, x = 0, y = 0): Rect {
  const k = Math.min(w / sw, h / sh);
  return { x: x + (w - sw * k) / 2, y: y + (h - sh * k) / 2, w: sw * k, h: sh * k };
}

/** 1 while drawing and for HOLD_MS after, then down to 0 over FADE_MS. */
export function inkAlpha(s: InkStroke, t: number) {
  return s.up === undefined ? 1 : Math.max(0, Math.min(1, 1 - (t - s.up - HOLD_MS) / FADE_MS));
}

/**
 * The stroke as it was at time `t`: the points drawn by then, plus a point
 * part-way to the next one (interpolated on their times), so playback moves
 * continuously between the points we have. Null before it starts.
 */
function pointsAt(s: InkStroke, t: number): InkPoint[] | null {
  let n = s.pts.findIndex((p) => p[2] > t);
  if (n === 0) return null;
  if (n < 0) return s.pts;
  const a = s.pts[n - 1], b = s.pts[n];
  const k = (t - a[2]) / (b[2] - a[2] || 1);
  const lerp = (i: number) => a[i]! + (b[i]! - a[i]!) * k;
  const tail: InkPoint = [lerp(0), lerp(1), t];
  if (a[3] !== undefined && b[3] !== undefined) tail.push(lerp(3));
  return [...s.pts.slice(0, n), tail];
}

export interface InkLabels {
  /** Name on each person's pencil. */
  name: (id: PeerId) => string;
  /** No pencil for this person (live, your own pointer is already there). */
  self?: PeerId;
}

/**
 * Draws every stroke as it was at time `t` into `rect`, with a pencil and the
 * drawer's name at the tip of each person's latest stroke. perfect-freehand
 * turns each stroke into a filled outline: thinner where the pen moved fast
 * (or pressed lightly, with a stylus), tapered once it lifts.
 */
export function drawInk(ctx: Ctx, strokes: Iterable<InkStroke>, t: number, rect: Rect, labels?: InkLabels) {
  const size = Math.max(3, rect.h * 0.0066); // 7 px in a 1080p picture
  const pencils = new Map<PeerId, { at: InkPoint; start: number; alpha: number; color: string }>();
  ctx.save();
  for (const s of strokes) {
    const a = inkAlpha(s, t);
    const pts = a > 0 ? pointsAt(s, t) : null;
    if (!pts) continue;
    const xy = pts.map(([x, y, , p]) => [rect.x + x * rect.w, rect.y + y * rect.h, p ?? 0.5]);
    const outline = getStroke(xy, { size, thinning: 0.4, smoothing: 0.5, streamline: 0.3, simulatePressure: pts[0][3] === undefined, last: s.up !== undefined && t >= s.up });
    if (outline.length) {
      ctx.globalAlpha = a;
      ctx.fillStyle = inkColor(s);
      ctx.beginPath();
      // Smooth outline: quadratic curves through the midpoints.
      ctx.moveTo(outline[0][0], outline[0][1]);
      for (let i = 0; i < outline.length; i++) {
        const [x, y] = outline[i];
        const [nx, ny] = outline[(i + 1) % outline.length];
        ctx.quadraticCurveTo(x, y, (x + nx) / 2, (y + ny) / 2);
      }
      ctx.closePath();
      ctx.fill();
    }
    // One pencil per person, on their latest stroke.
    const since = s.up === undefined || t < s.up ? 0 : t - s.up;
    const alpha = Math.max(0, Math.min(1, (CURSOR_MS - since) / CURSOR_FADE_MS));
    const prev = pencils.get(s.by);
    if (labels && s.by !== labels.self && alpha > 0 && (!prev || prev.start < s.pts[0][2])) pencils.set(s.by, { at: pts[pts.length - 1], start: s.pts[0][2], alpha, color: inkColor(s) });
  }
  for (const [by, p] of pencils) drawPencil(ctx, rect.x + p.at[0] * rect.w, rect.y + p.at[1] * rect.h, rect.h, p.color, labels!.name(by), p.alpha);
  ctx.restore();
}

/** A pencil with its tip at (x, y), leaning up and to the right, and a name tag just below it, sized for a picture `ph` tall. */
function drawPencil(ctx: Ctx, x: number, y: number, ph: number, color: string, name: string, alpha: number) {
  const u = Math.max(7, ph * 0.0115); // pencil unit: 12 px at 1080p
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  ctx.save();
  ctx.rotate(-Math.PI / 4);
  ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
  ctx.shadowBlur = u * 0.5;
  const w = 0.42 * u;
  const part = (fill: string, ...xy: number[]) => {
    ctx.fillStyle = fill;
    ctx.beginPath();
    for (let i = 0; i < xy.length; i += 2) ctx.lineTo(xy[i] * u, xy[i + 1] * u);
    ctx.fill();
  };
  // Along +x from the tip: lead, sharpened wood, painted body, ferrule, eraser.
  part('#f2d3a2', 0, 0, 0.95, -0.42, 0.95, 0.42);
  ctx.shadowColor = 'transparent';
  part('#2b2b2b', 0, 0, 0.34, -0.15, 0.34, 0.15);
  ctx.fillStyle = color;
  ctx.fillRect(0.95 * u, -w, 1.45 * u, 2 * w);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.18)'; // shading down one side
  ctx.fillRect(0.95 * u, 0.12 * u, 1.45 * u, w - 0.12 * u);
  ctx.fillStyle = '#c9ccd3';
  ctx.fillRect(2.4 * u, -w, 0.2 * u, 2 * w);
  ctx.fillStyle = '#f49ab0';
  ctx.beginPath();
  ctx.roundRect(2.6 * u, -w, 0.45 * u, 2 * w, [0, 0.2 * u, 0.2 * u, 0]);
  ctx.fill();
  ctx.restore();

  // Name tag in their colour, tucked in below and right of the tip.
  const l = Math.max(10, ph * 0.015); // tag unit: 16 px at 1080p
  const label = name.length > 22 ? name.slice(0, 21) + '…' : name;
  ctx.font = `600 ${Math.round(l * 1.05)}px system-ui, sans-serif`;
  const tw = ctx.measureText(label).width, h = l * 1.7;
  const bx = l * 0.2, by = l * 0.3;
  ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
  ctx.shadowBlur = l * 0.5;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(bx, by, tw + l * 1.1, h, h / 2);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = luminance(color) > 0.55 ? '#111' : '#fff';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, bx + l * 0.55, by + h / 2 + l * 0.04);
  ctx.restore();
}

function luminance(hex: string) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
