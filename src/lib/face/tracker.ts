// Finds the main face and keeps following it, the way real-time face trackers
// do. The model sees 128x128, so give it a close-up:
// - Searching (no face yet, or lost): scan the frame as squares (for 16:9, two
//   overlapping halves), so a face isn't squashed into the few pixels a whole
//   letterboxed frame would leave it.
// - Tracking: look only in a square about 3x the last face, where it fills a
//   good part of the input: steadier and more sure.
import type { BlazeFace, Face } from './blazeface';

export class FaceTracker {
  private last: Face | null = null;

  constructor(
    private det: BlazeFace,
    private context = 3,
  ) {}

  /** The main face in a w x h source, or null. */
  update(source: CanvasImageSource, w: number, h: number): Face | null {
    if (this.last) {
      const f = this.last;
      const side = Math.min(Math.max(w, h), Math.max(f.w, f.h) * this.context);
      const region = { x: f.x + f.w / 2 - side / 2, y: f.y + f.h / 2 - side / 2, w: side, h: side };
      const found = nearest(this.det.detect(source, w, h, { region }), f);
      if (found) return (this.last = found);
    }
    const side = Math.min(w, h);
    const long = Math.max(w, h);
    const n = Math.ceil(long / side);
    let all: Face[] = [];
    for (let i = 0; i < n; i++) {
      const off = n === 1 ? 0 : (i * (long - side)) / (n - 1);
      const region = w >= h ? { x: off, y: 0, w: side, h: side } : { x: 0, y: off, w: side, h: side };
      all = all.concat(this.det.detect(source, w, h, { region }));
    }
    return (this.last = all.length ? all.reduce((a, b) => (a.w * a.h >= b.w * b.h ? a : b)) : null);
  }
}

function nearest(faces: Face[], to: Face) {
  if (!faces.length) return null;
  const d = (f: Face) => Math.hypot(f.x + f.w / 2 - (to.x + to.w / 2), f.y + f.h / 2 - (to.y + to.h / 2));
  return faces.reduce((a, b) => (d(a) <= d(b) ? a : b));
}
