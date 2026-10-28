// A tiny runner for Google's BlazeFace short-range face detector
// (blaze_face_short_range.tflite, 230 KB, Apache-2.0). It implements just the
// ops that model uses, with the inner loops in hand-written WebAssembly SIMD
// (kernels.wat, 1.6 KB), plus the anchor decoding and weighted non-max
// suppression MediaPipe applies to its outputs. Its output matches
// MediaPipe's FaceDetector (experiments/face-detect has the comparisons).
//
//   const det = await BlazeFace.load(modelUrl, kernelsUrl);
//   det.detect(bitmap) // [{ x, y, w, h, score, keypoints }] in source pixels

import { readTflite, type Model, type Tensor } from './tflite';

const SIZE = 128;

// Smallest module using a SIMD instruction: validates only where SIMD works.
const SIMD_TEST = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]);
export const faceDetectionSupported = () => typeof WebAssembly === 'object' && WebAssembly.validate(SIMD_TEST) && typeof OffscreenCanvas !== 'undefined';

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

interface Kernels {
  pointwise(x: number, P: number, C: number, w: number, O: number, b: number, y: number, relu: number): void;
  depthwise(x: number, H: number, W: number, C: number, w: number, b: number, y: number, OH: number, OW: number, s: number, pt: number, pl: number, relu: number): void;
  unfold(x: number, H: number, W: number, C: number, K: number, s: number, pt: number, pl: number, y: number, OH: number, OW: number): void;
  maxpool2(x: number, H: number, W: number, C: number, y: number): void;
  padChannels(x: number, P: number, C: number, OC: number, y: number): void;
  add(x: number, z: number, y: number, n: number, relu: number): void;
}

export class BlazeFace {
  static async load(modelUrl: string, kernelsUrl: string) {
    const [model, kernels] = await Promise.all([
      fetch(modelUrl).then((r) => r.arrayBuffer()).then(readTflite),
      fetch(kernelsUrl).then((r) => r.arrayBuffer()).then((b) => WebAssembly.compile(b)),
    ]);
    return new BlazeFace(model, kernels);
  }

  private steps: (() => void)[] = [];
  private input: Float32Array;
  private scores: Float32Array;
  private boxes: Float32Array;
  private anchors = anchors();
  private ctx: OffscreenCanvasRenderingContext2D;

  constructor(model: Model, kernels: WebAssembly.Module) {
    const { tensors } = model;
    const size = (t: Tensor) => t.shape.reduce((a, b) => a * b, 1);

    // Simplify the graph: DEQUANTIZE (weights are already float) and RESHAPE
    // just alias their input; a RELU that's the only reader of a conv's or
    // add's output is folded into that op.
    const alias = tensors.map((_, i) => i);
    const readers = new Map<number, number>();
    for (const op of model.ops) for (const i of op.inputs) readers.set(i, (readers.get(i) ?? 0) + 1);
    const producer = new Map<number, (typeof model.ops)[number]>();
    const plan: typeof model.ops = [];
    for (const op of model.ops) {
      const inputs = op.inputs.map((i) => alias[i]);
      const from = producer.get(inputs[0]);
      if (op.name === 'DEQUANTIZE' || op.name === 'RESHAPE') alias[op.outputs[0]] = inputs[0];
      else if (op.name === 'RELU' && from && !from.act && readers.get(op.inputs[0]) === 1 && ['CONV_2D', 'DEPTHWISE_CONV_2D', 'ADD'].includes(from.name)) {
        from.act = 'relu';
        alias[op.outputs[0]] = inputs[0];
      } else {
        const step = { ...op, inputs };
        plan.push(step);
        producer.set(op.outputs[0], step);
      }
    }

    // One block of WebAssembly memory (16-byte aligned slots). Weights, the
    // input and the outputs keep their place; each intermediate result reuses
    // the space of one that's no longer needed.
    let top = 16;
    const bytesOf = (n: number) => Math.ceil((n * 4) / 16) * 16;
    const reserve = (n: number) => {
      const at = top;
      top += bytesOf(n);
      return at;
    };
    const ptr = tensors.map(() => -1);
    const fixed = new Set([...model.inputs, ...model.outputs.map((i) => alias[i])]);
    tensors.forEach((t, i) => {
      if (alias[i] === i && (t.data || fixed.has(i))) ptr[i] = reserve(size(t));
    });
    const lastUse = new Map<number, number>();
    plan.forEach((op, s) => op.inputs.forEach((i) => lastUse.set(i, s)));
    const free: { at: number; bytes: number }[] = [];
    plan.forEach((op, s) => {
      for (const o of op.outputs) {
        if (ptr[o] >= 0) continue;
        const need = bytesOf(size(tensors[o]));
        const fit = free.filter((f) => f.bytes >= need).sort((a, b) => a.bytes - b.bytes)[0];
        if (fit) {
          free.splice(free.indexOf(fit), 1);
          ptr[o] = fit.at;
          if (fit.bytes > need) free.push({ at: fit.at + need, bytes: fit.bytes - need });
        } else ptr[o] = reserve(size(tensors[o]));
      }
      for (const i of op.inputs)
        if (lastUse.get(i) === s && !tensors[i].data && !fixed.has(i)) free.push({ at: ptr[i], bytes: bytesOf(size(tensors[i])) });
    });
    // Convs run as [K][O]-transposed weights; the 5x5 stem also unfolds its
    // input patches ("im2col") so it can use the 1x1 kernel.
    const convExtra = new Map<(typeof plan)[number], { wT: number; cols: number }>();
    for (const op of plan) {
      if (op.name !== 'CONV_2D') continue;
      const [O, KH, KW, C] = tensors[op.inputs[1]].shape;
      const [, OH, OW] = tensors[op.outputs[0]].shape;
      const spatial = KH > 1 || KW > 1 || op.sw! > 1;
      convExtra.set(op, { wT: reserve(KH * KW * C * Math.ceil(O / 4) * 4), cols: spatial ? reserve(OH * OW * KH * KW * C) : -1 });
    }

    const mem = new WebAssembly.Memory({ initial: Math.ceil((top + 64) / 65536) }); // +64: a bias vector may read past its end
    const k = new WebAssembly.Instance(kernels, { env: { mem } }).exports as unknown as Kernels;
    const P = ptr.map((_, i) => ptr[alias[i]]);
    const view = (i: number) => new Float32Array(mem.buffer, P[i], size(tensors[i]));
    tensors.forEach((t, i) => t.data && view(i).set(t.data));
    for (const [op, e] of convExtra) {
      const w = tensors[op.inputs[1]].data as Float32Array;
      const O = tensors[op.inputs[1]].shape[0];
      const K = w.length / O;
      const O4 = Math.ceil(O / 4) * 4;
      const wT = new Float32Array(mem.buffer, e.wT, K * O4);
      for (let o = 0; o < O; o++) for (let i = 0; i < K; i++) wT[i * O4 + o] = w[o * K + i];
    }

    // Compile the plan into kernel calls.
    const shape = (i: number) => tensors[i].shape;
    const padBefore = (inSize: number, outSize: number, kk: number, s: number) => Math.floor(Math.max((outSize - 1) * s + kk - inSize, 0) / 2);
    const fail = (op: (typeof plan)[number]) => new Error(`BlazeFace: unsupported ${op.name}`);
    for (const op of plan) {
      const [a, b, c] = op.inputs;
      const out = op.outputs[0];
      const relu = op.act === 'relu' ? 1 : op.act ? -1 : 0;
      if (relu < 0) throw fail(op);
      const [, H, W, C] = shape(a);
      const [, OH, OW, OC] = shape(out);
      switch (op.name) {
        case 'CONV_2D': {
          const [O, KH, KW] = shape(b);
          const e = convExtra.get(op)!;
          if ((OH * OW) % 2) throw fail(op);
          if (e.cols < 0) this.steps.push(() => k.pointwise(P[a], H * W, C, e.wT, O, P[c], P[out], relu));
          else {
            if (KH !== KW || op.sh !== op.sw) throw fail(op);
            const pt = op.same ? padBefore(H, OH, KH, op.sh!) : 0;
            const pl = op.same ? padBefore(W, OW, KW, op.sw!) : 0;
            this.steps.push(() => {
              k.unfold(P[a], H, W, C, KH, op.sh!, pt, pl, e.cols, OH, OW);
              k.pointwise(e.cols, OH * OW, KH * KW * C, e.wT, O, P[c], P[out], relu);
            });
          }
          break;
        }
        case 'DEPTHWISE_CONV_2D': {
          const [, KH, KW] = shape(b);
          if (KH !== 3 || KW !== 3 || op.sh !== op.sw) throw fail(op);
          const pt = op.same ? padBefore(H, OH, 3, op.sh!) : 0;
          const pl = op.same ? padBefore(W, OW, 3, op.sw!) : 0;
          this.steps.push(() => k.depthwise(P[a], H, W, C, P[b], P[c], P[out], OH, OW, op.sh!, pt, pl, relu));
          break;
        }
        case 'MAX_POOL_2D':
          if (op.fw !== 2 || op.fh !== 2 || op.sw !== 2 || op.sh !== 2 || H % 2 || W % 2) throw fail(op);
          this.steps.push(() => k.maxpool2(P[a], H, W, C, P[out]));
          break;
        case 'PAD': {
          // BlazeFace only appends channels.
          const pads = tensors[b].data as Int32Array;
          if (pads.slice(0, 7).some((p) => p !== 0)) throw fail(op);
          this.steps.push(() => k.padChannels(P[a], H * W, C, OC, P[out]));
          break;
        }
        case 'ADD': {
          const n = size(tensors[out]);
          if (n % 4) throw fail(op);
          this.steps.push(() => k.add(P[a], P[b], P[out], n, relu));
          break;
        }
        case 'CONCATENATION': {
          // [1, N, K] along axis 1: a plain append.
          if (op.axis !== 1) throw fail(op);
          const parts = op.inputs.map((i) => [P[i], size(tensors[i])] as const);
          this.steps.push(() => {
            const f = new Float32Array(mem.buffer);
            let o = P[out] / 4;
            for (const [p, n] of parts) {
              f.copyWithin(o, p / 4, p / 4 + n);
              o += n;
            }
          });
          break;
        }
        default:
          throw fail(op);
      }
    }
    this.input = view(model.inputs[0]);
    [this.boxes, this.scores] = model.outputs.map((i) => view(alias[i]));
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
    for (const step of this.steps) step();

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
