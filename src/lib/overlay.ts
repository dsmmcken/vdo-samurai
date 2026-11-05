// The presenter's camera overlay, in 1080p stage pixels: where each shape sits,
// and how the cutout (just the person) morphs to and from the boxed shapes.
// Shared by the live stage (Pip.tsx, the cutout worker) and the final render,
// so both draw the same thing at the same moment.
import { cropFor, type Head } from './framing';
import type { Corner, PipShape } from './types';

export const STAGE_W = 1920;
export const STAGE_H = 1080;
export const PIP_MARGIN = 32;
/** Shape changes, corner moves and hiding all take this long. */
export const PIP_MOVE_S = 0.4;

// Same as the .s-* rules in styles.css.
export const PIP_DIMS: Record<PipShape, { w: number; h: number; r: number }> = {
  rect: { w: 156, h: 195, r: 22 },
  square: { w: 176, h: 176, r: 22 },
  circle: { w: 184, h: 184, r: 92 },
  // Nothing around the person to take up room, so it's bigger.
  cutout: { w: 324, h: 360, r: 0 },
};

/** How much of the cutout's height the head fills: less than the boxes, so shoulders show. */
export const CUTOUT_FILL = 0.4;
/**
 * Where across the cutout the head sits, from its inner side: toward the
 * outer edge, close to where the boxes put it, so switching moves it little.
 */
export const CUTOUT_HEAD_X = 0.6;
/** Where down the cutout the head's centre sits (as cropFor frames narrow views). */
const HEAD_Y = 0.46;

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  r: number;
}

export interface Crop {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Where a shape sits for a corner. Boxes keep a margin from the edges; a
 * cutout sits on the bottom edge and against the side, its body running off
 * the picture.
 */
export function pipBox(corner: Corner, shape: PipShape): Box {
  const { w, h, r } = PIP_DIMS[shape];
  const cut = shape === 'cutout';
  const side = cut ? 0 : PIP_MARGIN;
  return {
    x: corner.endsWith('r') ? STAGE_W - w - side : side,
    y: corner.startsWith('b') ? STAGE_H - h - (cut ? 0 : PIP_MARGIN) : PIP_MARGIN,
    w,
    h,
    r,
  };
}

/** Where across a cutout the head sits, for its corner (toward the outer side). */
export const cutoutHeadX = (corner: Corner) => (corner.endsWith('r') ? CUTOUT_HEAD_X : 1 - CUTOUT_HEAD_X);

/** The top of the head in a cutout, as a fraction of its height (for placing things above it). */
export const CUTOUT_HEAD_TOP = HEAD_Y - CUTOUT_FILL / 2;

/**
 * The part of a vw x vh camera frame a shape shows (unmirrored frame pixels).
 * `mirror`: the view is shown flipped, so an off-centre head goes the other way.
 * `hx` overrides where across a cutout the head goes (while it changes sides).
 */
export function pipCrop(corner: Corner, shape: PipShape, head: Head | null, vw: number, vh: number, mirror = false, hx = cutoutHeadX(corner)): Crop {
  const { w, h } = PIP_DIMS[shape];
  if (shape !== 'cutout') return cropFor(head, vw, vh, w / h);
  return cropFor(head, vw, vh, w / h, CUTOUT_FILL, mirror ? 1 - hx : hx);
}

/**
 * Everything needed to draw a cutout, or a morph between it and a box, in
 * stage pixels:
 * - `bounds`: the area drawn into (it holds both shapes);
 * - `seg`: the part of the frame the person is found in (the cutout's crop);
 * - `map`: where the camera goes: frame point (u, v) lands at
 *   (px + (u - hu) * k * (flip ? -1 : 1), py + (v - hv) * k);
 * - `bg`: where the whole picture shows, background included (null: nowhere);
 * - `person`: where the person shows.
 */
export interface CutLayout {
  bounds: Box;
  seg: Crop;
  map: { k: number; px: number; py: number; hu: number; hv: number; flip: boolean };
  bg: Box | null;
  person: Box;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerpBox = (a: Box, b: Box, t: number): Box => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), w: lerp(a.w, b.w, t), h: lerp(a.h, b.h, t), r: lerp(a.r, b.r, t) });

/** Ease in-out, the same curve as the stage's CSS (cubic-bezier(0.65, 0, 0.35, 1)). */
export const easeInOut = (k: number) => (k < 0.5 ? 4 * k ** 3 : 1 - (-2 * k + 2) ** 3 / 2);

/**
 * The overlay `c` of the way from shape `box` to the cutout (0: the box,
 * 1: the cutout; `box` may be 'cutout' too, for a still cutout). `hx` as for
 * pipCrop.
 *
 * The face glides straight from where the box had it to where the cutout
 * has it, growing or shrinking steadily. Around it, the background shrinks
 * into the face (or, going the other way, grows out from behind it) while
 * the box's edges open out to the cutout's, letting the shoulders out.
 */
export function cutLayout(corner: Corner, box: PipShape, c: number, head: Head | null, vw: number, vh: number, mirror = false, hx = cutoutHeadX(corner)): CutLayout {
  const A = pipBox(corner, box);
  const C = pipBox(corner, 'cutout');
  const cropA = pipCrop(corner, box, head, vw, vh, mirror, hx);
  const cropC = pipCrop(corner, 'cutout', head, vw, vh, mirror, hx);
  // The face's centre (or, with no face found, the middle of the cutout).
  const hu = head ? head.x * vw : cropC.x + cropC.w / 2;
  const hv = head ? head.y * vh : cropC.y + cropC.h * HEAD_Y;
  const at = (b: Box, crop: Crop) => {
    const k = b.w / crop.w;
    return { k, x: b.x + (mirror ? crop.x + crop.w - hu : hu - crop.x) * k, y: b.y + (hv - crop.y) * k };
  };
  const a = at(A, cropA);
  const z = at(C, cropC);
  const map = { k: lerp(a.k, z.k, c), px: lerp(a.x, z.x, c), py: lerp(a.y, z.y, c), hu, hv, flip: mirror };
  const x0 = Math.min(A.x, C.x);
  const y0 = Math.min(A.y, C.y);
  const bounds = { x: x0, y: y0, w: Math.max(A.x + A.w, C.x + C.w) - x0, h: Math.max(A.y + A.h, C.y + C.h) - y0, r: 0 };
  // The background closes in on the face as it moves, rounding as it shrinks.
  const bg = c >= 1 || box === 'cutout' ? null : lerpBox(A, { x: map.px, y: map.py, w: 0, h: 0, r: Math.max(A.w, A.h) / 2 }, c);
  return { bounds, seg: cropC, map, bg, person: box === 'cutout' ? C : lerpBox(A, C, c) };
}
