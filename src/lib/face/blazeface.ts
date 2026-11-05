// Google's BlazeFace short-range face detector (blaze_face_short_range.tflite,
// 230 KB, Apache-2.0) on our own tiny runner (nn/net.ts, with the inner loops
// in hand-written WebAssembly SIMD), plus the anchor decoding and weighted
// non-max suppression MediaPipe applies to its outputs. Its output matches
// MediaPipe's FaceDetector (experiments/face-detect has the comparisons).
//
//   const det = await BlazeFace.load(modelUrl, kernelsUrl);
//   det.detect(bitmap) // [{ x, y, w, h, score, keypoints }] in source pixels

import { Net, simdSupported } from '../nn/net';

const SIZE = 128;

export const faceDetectionSupported = () => simdSupported() && typeof OffscreenCanvas !== 'undefined';

export interface Face {
  x: number;
  y: number;
  w: number;
  h: number;
  score: number;
  /** Right eye, left eye, nose tip, mouth, right ear, left ear. */
  keypoints: [number, number][];
}

export interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
}

export class BlazeFace {
  static async load(modelUrl: string, kernelsUrl: string) {
    return new BlazeFace(await Net.load(modelUrl, kernelsUrl));
  }

  private input: Float32Array;
  private scores: Float32Array;
  private boxes: Float32Array;
  private anchors = anchors();
  private ctx: OffscreenCanvasRenderingContext2D;

  constructor(private net: Net) {
    this.input = net.inputs[0];
    [this.boxes, this.scores] = net.outputs;
    this.ctx = new OffscreenCanvas(SIZE, SIZE).getContext('2d', { willReadFrequently: true })!;
  }

  /**
   * Faces in `source` (w x h), or in just `region` of it (parts outside read
   * as black). Results are in source pixels either way.
   */
  detect(source: CanvasImageSource, w: number, h: number, { region, minScore = 0.5 }: { region?: Region; minScore?: number } = {}): Face[] {
    const r = region ?? { x: 0, y: 0, w, h };
    // Letterbox the region into 128x128, keeping its aspect ratio.
    const s = SIZE / Math.max(r.w, r.h);
    const ox = (SIZE - r.w * s) / 2 - r.x * s;
    const oy = (SIZE - r.h * s) / 2 - r.y * s;
    const g = this.ctx;
    g.fillStyle = '#000';
    g.fillRect(0, 0, SIZE, SIZE);
    g.drawImage(source, ox, oy, w * s, h * s);
    const px = g.getImageData(0, 0, SIZE, SIZE).data;
    const input = this.input;
    for (let i = 0, j = 0; i < SIZE * SIZE; i++, j += 4) {
      input[i * 3] = px[j] / 127.5 - 1;
      input[i * 3 + 1] = px[j + 1] / 127.5 - 1;
      input[i * 3 + 2] = px[j + 2] / 127.5 - 1;
    }
    this.net.run();

    const cands: Cand[] = [];
    for (let i = 0; i < this.anchors.length; i++) {
      const score = 1 / (1 + Math.exp(-Math.max(-100, Math.min(100, this.scores[i]))));
      if (score < minScore) continue;
      const [ax, ay] = this.anchors[i];
      const b = this.boxes.subarray(i * 16, i * 16 + 16);
      const cx = b[0] / SIZE + ax;
      const cy = b[1] / SIZE + ay;
      const bw = b[2] / SIZE;
      const bh = b[3] / SIZE;
      const kp: [number, number][] = [];
      for (let j = 0; j < 6; j++) kp.push([b[4 + j * 2] / SIZE + ax, b[5 + j * 2] / SIZE + ay]);
      cands.push({ score, box: [cx - bw / 2, cy - bh / 2, cx + bw / 2, cy + bh / 2], kp });
    }
    const toSrc = (x: number, y: number): [number, number] => [(x * SIZE - ox) / s, (y * SIZE - oy) / s];
    return weightedNms(cands, 0.3).map(({ score, box, kp }) => {
      const [x0, y0] = toSrc(box[0], box[1]);
      const [x1, y1] = toSrc(box[2], box[3]);
      return { x: x0, y: y0, w: x1 - x0, h: y1 - y0, score, keypoints: kp.map(([x, y]) => toSrc(x, y)) };
    });
  }
}

interface Cand {
  score: number;
  box: number[];
  kp: [number, number][];
}

// SSD anchors for the short-range model: a 16x16 grid with 2 anchors per
// cell (stride 8), then an 8x8 grid with 6 (three stride-16 layers merged).
function anchors() {
  const out: [number, number][] = [];
  for (const [grid, per] of [
    [16, 2],
    [8, 6],
  ])
    for (let y = 0; y < grid; y++) for (let x = 0; x < grid; x++) for (let k = 0; k < per; k++) out.push([(x + 0.5) / grid, (y + 0.5) / grid]);
  return out;
}

// MediaPipe's "weighted" NMS: overlapping candidates are averaged by score,
// which steadies the box from frame to frame.
function weightedNms(cands: Cand[], iouMin: number) {
  cands.sort((a, b) => b.score - a.score);
  const out: Cand[] = [];
  while (cands.length) {
    const top = cands[0];
    const group: Cand[] = [];
    const rest: Cand[] = [];
    for (const c of cands) (iou(top.box, c.box) > iouMin ? group : rest).push(c);
    cands = rest;
    const total = group.reduce((t, c) => t + c.score, 0);
    const avg = (f: (c: Cand) => number) => group.reduce((t, c) => t + f(c) * c.score, 0) / total;
    out.push({
      score: top.score,
      box: [0, 1, 2, 3].map((i) => avg((c) => c.box[i])),
      kp: top.kp.map((_, j) => [avg((c) => c.kp[j][0]), avg((c) => c.kp[j][1])] as [number, number]),
    });
  }
  return out;
}

function iou(a: number[], b: number[]) {
  const w = Math.min(a[2], b[2]) - Math.max(a[0], b[0]);
  const h = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
  if (w <= 0 || h <= 0) return 0;
  const i = w * h;
  return i / ((a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - i);
}
