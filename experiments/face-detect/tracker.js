// Finds the main face in a video and keeps following it, the way real-time
// face trackers do: the model sees 128x128, so give it a close-up.
//
// - Searching (no face yet, or lost): scan the frame as squares (for 16:9,
//   left and right halves overlapping), so a face isn't squashed into the
//   few pixels a whole letterboxed frame would leave it.
// - Tracking: look only in a square around the last face, ~3x its size,
//   where it fills a good part of the model's input: steadier and more sure.

import { sourceSize } from './blazeface.js';

export class FaceTracker {
  constructor(detector, { context = 3, minScore = 0.5 } = {}) {
    this.det = detector;
    this.context = context;
    this.minScore = minScore;
    this.last = null; // last face, source pixels
    this.runs = 0; // network runs in the last update (1 tracking, 2 searching)
  }

  /** Returns the main face { x, y, w, h, score, keypoints } or null. */
  update(source) {
    const [W, H] = sourceSize(source);
    this.runs = 0;
    if (this.last) {
      const f = this.last;
      const side = Math.min(Math.max(W, H), Math.max(f.w, f.h) * this.context);
      const region = { x: f.x + f.w / 2 - side / 2, y: f.y + f.h / 2 - side / 2, w: side, h: side };
      const found = this.best(this.det.detect(source, { region, minScore: this.minScore }), f);
      this.runs++;
      if (found) return (this.last = found);
    }
    // Search: squares across the long side (two for 16:9 or 4:3).
    const side = Math.min(W, H);
    const n = Math.ceil(Math.max(W, H) / side);
    let all = [];
    for (let i = 0; i < n; i++) {
      const off = n === 1 ? 0 : (i * (Math.max(W, H) - side)) / (n - 1);
      const region = W >= H ? { x: off, y: 0, w: side, h: side } : { x: 0, y: off, w: side, h: side };
      all = all.concat(this.det.detect(source, { region, minScore: this.minScore }));
      this.runs++;
    }
    return (this.last = this.best(all, null));
  }

  /** The biggest face, or (when tracking) the one nearest the last. */
  best(faces, near) {
    if (!faces.length) return null;
    const c = (f) => [f.x + f.w / 2, f.y + f.h / 2];
    if (near) {
      const [nx, ny] = c(near);
      return faces.reduce((a, b) => (Math.hypot(c(a)[0] - nx, c(a)[1] - ny) <= Math.hypot(c(b)[0] - nx, c(b)[1] - ny) ? a : b));
    }
    return faces.reduce((a, b) => (a.w * a.h >= b.w * b.h ? a : b));
  }
}
