// Camera auto-framing. Each person finds their own head (face/worker.ts) and
// shares where the frame should centre it: a "head" anchor. Every view of
// their camera (tiles, stage, overlay, end screen, and the final render)
// crops to that anchor for its own shape, gliding between anchors.
//
// The anchor moves calmly, not with every twitch:
// - the detector's wobble is smoothed out (One Euro filter);
// - a dead zone: moves smaller than DEAD_ZONE of the framed view are ignored;
// - the head must stay outside it for SETTLE_S before the frame follows,
//   then it follows until the head has been still for REST_S;
// - zoom only changes when the head's size is off by more than ZOOM_MARGIN;
// - when the face is lost, the anchor stays where it was.

/** Where to frame: head centre (x across the width, y down the height) and head height, all as fractions of the camera frame. */
export interface Head {
  x: number;
  y: number;
  s: number;
}

export const DETECT_HZ = 5;
const DEAD_ZONE = 0.25;
const SETTLE_S = 0.5;
const REST_MOVE = 0.012;
const REST_S = 0.4;
const ZOOM_MARGIN = 0.2;
/** How much of a framed view's height the head fills (narrow views; wide ones use 60% of this). */
const FILL = 0.6;
/** Views glide toward a new anchor with this time constant (there in about 1 s). */
export const GLIDE_S = 1 / 3;

/** A detected face (eyes-to-mouth box) as a head: forehead and hair above, a little chin and width. */
export function headFromFace(f: { x: number; y: number; w: number; h: number }, W: number, H: number): Head {
  return { x: (f.x + f.w / 2) / W, y: (f.y + f.h * 0.15) / H, s: (f.h * 1.85) / H };
}

/**
 * The crop of a vw x vh camera frame that frames `head` in a box of aspect
 * `aspect` (width / height), in frame pixels. Without a head it's the plain
 * centred "cover" crop.
 */
export function cropFor(head: Head | null, vw: number, vh: number, aspect: number) {
  // Largest crop of this aspect that fits the frame (what "cover" shows).
  const coverH = vw / vh > aspect ? vh : vw / aspect;
  if (!head) return { x: (vw - coverH * aspect) / 2, y: (vh - coverH) / 2, w: coverH * aspect, h: coverH };
  const wide = aspect >= 1.3;
  const fill = FILL * (wide ? 0.6 : 1);
  const maxZoom = wide ? 2.5 : 3.5;
  const headY = wide ? 0.42 : 0.46; // head centre this far down the view
  const h = Math.min(coverH, Math.max(coverH / maxZoom, (head.s * vh) / fill));
  const w = h * aspect;
  return {
    x: Math.min(vw - w, Math.max(0, head.x * vw - w / 2)),
    y: Math.min(vh - h, Math.max(0, head.y * vh - h * headY)),
    w,
    h,
  };
}

/** Moves `cur` toward `to` over `dt` seconds (exponential glide). */
export function glide(cur: Head, to: Head, dt: number): Head {
  const k = 1 - Math.exp(-dt / GLIDE_S);
  return { x: cur.x + (to.x - cur.x) * k, y: cur.y + (to.y - cur.y) * k, s: cur.s + (to.s - cur.s) * k };
}

// One Euro filter (Casiez et al. 2012): heavy smoothing when still, light when moving.
class OneEuro {
  private x: number | null = null;
  private dx = 0;
  private t = 0;
  constructor(
    private minCutoff: number,
    private beta: number,
    private dCutoff = 1,
  ) {}
  filter(v: number, t: number) {
    if (this.x === null) {
      this.t = t;
      return (this.x = v);
    }
    const dt = Math.max(1e-3, (t - this.t) / 1000);
    this.t = t;
    const a = (cutoff: number) => 1 / (1 + 1 / (2 * Math.PI * cutoff * dt));
    this.dx += a(this.dCutoff) * ((v - this.x) / dt - this.dx);
    this.x += a(this.minCutoff + this.beta * Math.abs(this.dx)) * (v - this.x);
    return this.x;
  }
}

/**
 * Turns per-detection heads into the calm anchor described at the top.
 * Positions are in "720p pixels" (fractions x 720) so the filter tuning
 * doesn't depend on the camera's resolution.
 */
export class Framer {
  private fx = new OneEuro(0.6, 0.004);
  private fy = new OneEuro(0.6, 0.004);
  private fs = new OneEuro(0.3, 0.002);
  private anchor: Head | null = null;
  private following = false;
  private movingSince = 0;
  private restingSince = 0;
  private last: Head | null = null;

  /** Feed a detection (or null when no face); returns the anchor. */
  update(raw: Head | null, aspect: number, now: number): Head | null {
    if (!raw) return this.anchor; // lost: hold
    const U = 720;
    const h: Head = { x: this.fx.filter(raw.x * aspect * U, now) / (aspect * U), y: this.fy.filter(raw.y * U, now) / U, s: this.fs.filter(raw.s * U, now) / U };
    const a = this.anchor;
    if (!a) {
      this.last = h;
      return (this.anchor = h);
    }
    const view = a.s / FILL; // height of the framed view, as a fraction of the frame
    const off = (p: Head, q: Head) => Math.max(Math.abs(p.x - q.x) * aspect, Math.abs(p.y - q.y)) / view;
    const sizeOff = Math.abs(h.s / a.s - 1);
    if (this.following) {
      const still = this.last && off(h, this.last) < REST_MOVE && Math.abs(h.s / this.last.s - 1) < REST_MOVE * 2;
      if (!still) this.restingSince = 0;
      else if (!this.restingSince) this.restingSince = now;
      else if (now - this.restingSince >= REST_S * 1000) this.following = false;
      this.anchor = { x: h.x, y: h.y, s: sizeOff > ZOOM_MARGIN ? h.s : a.s };
    } else if (off(h, a) > DEAD_ZONE || sizeOff > ZOOM_MARGIN) {
      this.movingSince ||= now;
      if (now - this.movingSince >= SETTLE_S * 1000) {
        this.following = true;
        this.movingSince = 0;
        this.restingSince = 0;
      }
    } else this.movingSince = 0;
    this.last = h;
    return this.anchor;
  }
}

/** Anchors are shared rounded, so tiny changes don't cause traffic. */
export const roundHead = (h: Head): Head => ({ x: Math.round(h.x * 1000) / 1000, y: Math.round(h.y * 1000) / 1000, s: Math.round(h.s * 1000) / 1000 });
export const sameHead = (a: Head | null | undefined, b: Head | null | undefined) => (!a || !b ? a === b : a.x === b.x && a.y === b.y && a.s === b.s);
