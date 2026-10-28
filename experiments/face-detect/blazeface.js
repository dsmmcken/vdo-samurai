// A tiny, dependency-free runner for Google's BlazeFace short-range model
// (blaze_face_short_range.tflite, 230 KB). It implements only the nine ops
// that model uses, in plain JavaScript, plus the SSD anchor decoding and
// weighted non-max suppression MediaPipe applies to its outputs.
//
//   const det = await BlazeFace.load(url);
//   const faces = det.detect(source);   // ImageBitmap | canvas | VideoFrame | <video>
//   // [{ x, y, w, h, score, keypoints: [[x,y] x6] }] in source pixels

import { readTflite } from './tflite.js';

const SIZE = 128;

const SIMD_TEST = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]);

export class BlazeFace {
  /** `simd: false` forces the plain-JavaScript ops (also the fallback without WebAssembly SIMD). */
  static async load(url, { simd = true } = {}) {
    const [model, kernels] = await Promise.all([
      fetch(url).then((r) => r.arrayBuffer()).then(readTflite),
      simd && WebAssembly.validate(SIMD_TEST) ? WebAssembly.compileStreaming(fetch(new URL('./kernels.wasm', import.meta.url))) : null,
    ]);
    return new BlazeFace(model, kernels);
  }

  constructor(model, kernels = null) {
    this.model = model;
    const { tensors } = model;
    // Simplify the graph. DEQUANTIZE (the weights are already float) and
    // RESHAPE (same data, new shape) just alias their input; a RELU that's
    // the only reader of a conv's or add's output is folded into that op.
    const alias = tensors.map((_, i) => i);
    const readers = new Map();
    for (const op of model.ops) for (const i of op.inputs) readers.set(i, (readers.get(i) ?? 0) + 1);
    const producer = new Map();
    this.plan = [];
    for (const op of model.ops) {
      const inputs = op.inputs.map((i) => alias[i]);
      const from = producer.get(inputs[0]);
      if (op.name === 'DEQUANTIZE' || op.name === 'RESHAPE') alias[op.outputs[0]] = inputs[0];
      else if (op.name === 'RELU' && from && !from.act && readers.get(op.inputs[0]) === 1 && ['CONV_2D', 'DEPTHWISE_CONV_2D', 'ADD'].includes(from.name)) {
        from.act = 'relu';
        alias[op.outputs[0]] = inputs[0];
      } else {
        const step = { ...op, inputs };
        this.plan.push(step);
        producer.set(op.outputs[0], step);
      }
    }
    const size = (t) => t.shape.reduce((a, b) => a * b, 1);

    // Lay every tensor out in one block of memory (16-byte aligned), shared
    // with the WebAssembly kernels when they're in use. Weights, the input
    // and the outputs keep their place; each intermediate result reuses the
    // space of one that's no longer needed.
    let top = 16;
    const bytesOf = (n) => Math.ceil((n * 4) / 16) * 16;
    const reserve = (n) => {
      const at = top;
      top += bytesOf(n);
      return at;
    };
    const ptr = tensors.map(() => -1);
    const fixed = new Set([...model.inputs, ...model.outputs.map((i) => alias[i])]);
    tensors.forEach((t, i) => {
      if (alias[i] === i && (t.data || fixed.has(i))) ptr[i] = reserve(size(t));
    });
    const lastUse = new Map();
    this.plan.forEach((op, s) => op.inputs.forEach((i) => lastUse.set(i, s)));
    const free = []; // [{ at, bytes }]
    this.plan.forEach((op, s) => {
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
    // SIMD convs want weights as [K][O] (see kernels.wat); the 5x5 layer
    // also needs room to unfold its input patches.
    const extra = new Map();
    if (kernels)
      for (const op of this.plan) {
        if (op.name !== 'CONV_2D') continue;
        const [O, KH, KW, C] = tensors[op.inputs[1]].shape;
        const [, OH, OW] = tensors[op.outputs[0]].shape;
        if ((OH * OW) % 2) continue;
        const spatial = KH > 1 || KW > 1 || op.sw > 1;
        extra.set(op, { wT: reserve(KH * KW * C * Math.ceil(O / 4) * 4), cols: spatial ? reserve(OH * OW * KH * KW * C) : -1 });
      }
    const bytes = top + 64; // slack: a bias vector may read up to 3 floats past its end
    let heap;
    if (kernels) {
      const mem = new WebAssembly.Memory({ initial: Math.ceil(bytes / 65536) });
      this.k = new WebAssembly.Instance(kernels, { env: { mem } }).exports;
      heap = mem.buffer;
    } else heap = new ArrayBuffer(bytes);
    this.ptr = ptr.map((p, i) => ptr[alias[i]]);
    this.buf = this.ptr.map((p, i) => (p >= 0 ? new Float32Array(heap, p, size(tensors[i])) : null));
    tensors.forEach((t, i) => t.data && this.buf[i].set(t.data));
    for (const [op, e] of extra) {
      const w = tensors[op.inputs[1]].data;
      const [O] = tensors[op.inputs[1]].shape;
      const K = w.length / O, O4 = Math.ceil(O / 4) * 4;
      const wT = new Float32Array(heap, e.wT, K * O4);
      for (let o = 0; o < O; o++) for (let k = 0; k < K; k++) wT[k * O4 + o] = w[o * K + k];
      op.simd = e;
    }
    this.memoryBytes = bytes;
    this.anchors = anchors();
    this.canvas = new OffscreenCanvas(SIZE, SIZE);
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    this.timing = { prep: 0, net: 0 };
  }

  /** Runs the network on the 128x128x3 input already in place; returns [scores, boxes]. */
  run() {
    const { tensors } = this.model;
    const B = this.buf, P = this.ptr, k = this.k;
    const shape = (i) => tensors[i].shape;
    for (const op of this.plan) {
      const [a, b, c] = op.inputs;
      const out = op.outputs[0];
      const fuse = op.act === 'relu' ? 1 : 0;
      switch (op.name) {
        case 'CONV_2D':
          if (op.simd) {
            const [, H, W, C] = shape(a), [O, KH, KW] = shape(b), [, OH, OW] = shape(out);
            if (op.simd.cols < 0) k.pointwise(P[a], H * W, C, op.simd.wT, O, P[c], P[out], fuse);
            else {
              const pt = op.same ? padBefore(H, OH, KH, op.sh) : 0, pl = op.same ? padBefore(W, OW, KW, op.sw) : 0;
              if (KH === KW && op.sh === op.sw) k.unfold(P[a], H, W, C, KH, op.sh, pt, pl, op.simd.cols, OH, OW);
              else unfold(B[a], H, W, C, KH, KW, op.sh, op.sw, pt, pl, new Float32Array(B[out].buffer, op.simd.cols, OH * OW * KH * KW * C), OH, OW);
              k.pointwise(op.simd.cols, OH * OW, KH * KW * C, op.simd.wT, O, P[c], P[out], fuse);
            }
          } else conv(B[a], shape(a), B[b], shape(b), B[c], B[out], shape(out), op);
          break;
        case 'DEPTHWISE_CONV_2D':
          if (k) {
            const [, H, W, C] = shape(a), [, OH, OW] = shape(out);
            k.depthwise(P[a], H, W, C, P[b], P[c], P[out], OH, OW, op.sh, op.same ? padBefore(H, OH, 3, op.sh) : 0, op.same ? padBefore(W, OW, 3, op.sw) : 0, fuse);
          } else depthwise(B[a], shape(a), B[b], shape(b), B[c], B[out], shape(out), op);
          break;
        case 'MAX_POOL_2D':
          if (k && op.fw === 2 && op.fh === 2 && op.sw === 2 && op.sh === 2 && shape(a)[1] % 2 === 0 && shape(a)[2] % 2 === 0) k.maxpool2(P[a], shape(a)[1], shape(a)[2], shape(a)[3], P[out]);
          else maxpool(B[a], shape(a), B[out], shape(out), op);
          break;
        case 'PAD':
          if (k) k.padChannels(P[a], shape(a)[1] * shape(a)[2], shape(a)[3], shape(out)[3], P[out]);
          else padChannels(B[a], shape(a), B[out], shape(out));
          break;
        case 'ADD':
          if (k && B[out].length % 4 === 0) k.add(P[a], P[b], P[out], B[out].length, fuse);
          else add(B[a], B[b], B[out], op.act);
          break;
        case 'RELU': relu(B[a], B[out]); break;
        case 'CONCATENATION': concat(op.inputs.map((i) => B[i]), B[out]); break;
        default: throw new Error(`op ${op.name} not supported`);
      }
    }
    const [boxes, scores] = this.model.outputs.map((i) => B[i]);
    return [scores, boxes];
  }

  /**
   * Detects faces in any drawable source, or in just `region` of it (source
   * pixels; parts outside the source read as black). Results are in source
   * pixels either way.
   */
  detect(source, { region = null, minScore = 0.5 } = {}) {
    const t0 = performance.now();
    const r0 = region ?? { x: 0, y: 0, w: sourceSize(source)[0], h: sourceSize(source)[1] };
    // Letterbox the region into 128x128 (keeps the aspect ratio, like MediaPipe).
    const s = SIZE / Math.max(r0.w, r0.h);
    const ox = (SIZE - r0.w * s) / 2 - r0.x * s, oy = (SIZE - r0.h * s) / 2 - r0.y * s;
    const g = this.ctx;
    g.fillStyle = '#000';
    g.fillRect(0, 0, SIZE, SIZE);
    const [w, h] = sourceSize(source);
    g.drawImage(source, ox, oy, w * s, h * s);
    const px = g.getImageData(0, 0, SIZE, SIZE).data;
    const input = this.buf[this.model.inputs[0]];
    for (let i = 0, j = 0; i < SIZE * SIZE; i++, j += 4) {
      input[i * 3] = px[j] / 127.5 - 1;
      input[i * 3 + 1] = px[j + 1] / 127.5 - 1;
      input[i * 3 + 2] = px[j + 2] / 127.5 - 1;
    }
    const t1 = performance.now();
    const [scores, boxes] = this.run();
    const t2 = performance.now();
    this.timing = { prep: t1 - t0, net: t2 - t1 };

    // Decode boxes relative to their anchors, then map back to source pixels.
    const cands = [];
    for (let i = 0; i < this.anchors.length; i++) {
      const score = 1 / (1 + Math.exp(-Math.max(-100, Math.min(100, scores[i]))));
      if (score < minScore) continue;
      const [ax, ay] = this.anchors[i];
      const r = boxes.subarray(i * 16, i * 16 + 16);
      const cx = r[0] / SIZE + ax, cy = r[1] / SIZE + ay, bw = r[2] / SIZE, bh = r[3] / SIZE;
      const kp = [];
      for (let k = 0; k < 6; k++) kp.push([r[4 + k * 2] / SIZE + ax, r[5 + k * 2] / SIZE + ay]);
      cands.push({ score, box: [cx - bw / 2, cy - bh / 2, cx + bw / 2, cy + bh / 2], kp });
    }
    const toSrc = (x, y) => [(x * SIZE - ox) / s, (y * SIZE - oy) / s];
    return weightedNms(cands, 0.3).map(({ score, box, kp }) => {
      const [x0, y0] = toSrc(box[0], box[1]);
      const [x1, y1] = toSrc(box[2], box[3]);
      return { x: x0, y: y0, w: x1 - x0, h: y1 - y0, score, keypoints: kp.map(([x, y]) => toSrc(x, y)) };
    });
  }
}

export const sourceSize = (s) => [s.displayWidth ?? s.videoWidth ?? s.width, s.displayHeight ?? s.videoHeight ?? s.height];

// SSD anchors for the short-range model: a 16x16 grid with 2 anchors per
// cell (stride 8), then an 8x8 grid with 6 (three stride-16 layers merged).
function anchors() {
  const out = [];
  for (const [grid, per] of [[16, 2], [8, 6]])
    for (let y = 0; y < grid; y++)
      for (let x = 0; x < grid; x++)
        for (let k = 0; k < per; k++) out.push([(x + 0.5) / grid, (y + 0.5) / grid]);
  return out;
}

// MediaPipe's "weighted" NMS: overlapping candidates are averaged by score,
// which steadies the box from frame to frame.
function weightedNms(cands, iouMin) {
  cands.sort((a, b) => b.score - a.score);
  const out = [];
  while (cands.length) {
    const top = cands[0];
    const group = [], rest = [];
    for (const c of cands) (iou(top.box, c.box) > iouMin ? group : rest).push(c);
    cands = rest;
    const total = group.reduce((t, c) => t + c.score, 0);
    const avg = (f) => group.reduce((t, c) => t + f(c) * c.score, 0) / total;
    out.push({
      score: top.score,
      box: [0, 1, 2, 3].map((i) => avg((c) => c.box[i])),
      kp: top.kp.map((_, k) => [avg((c) => c.kp[k][0]), avg((c) => c.kp[k][1])]),
    });
  }
  return out;
}

function iou(a, b) {
  const w = Math.min(a[2], b[2]) - Math.max(a[0], b[0]);
  const h = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
  if (w <= 0 || h <= 0) return 0;
  const i = w * h;
  return i / ((a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - i);
}

// ---- ops (NHWC, batch 1) ----

/** TensorFlow "SAME" padding: the amount added before the first row/column. */
const padBefore = (inSize, outSize, k, s) => Math.floor(Math.max((outSize - 1) * s + k - inSize, 0) / 2);

function conv(x, [, H, W, C], w, [O, KH, KW], bias, y, [, OH, OW], op) {
  if (KH === 1 && KW === 1 && op.sw === 1) pointwise(x, H * W, C, w, O, bias, y);
  else spatialConv(x, H, W, C, w, O, KH, KW, op.sh, op.sw, op.same ? padBefore(H, OH, KH, op.sh) : 0, op.same ? padBefore(W, OW, KW, op.sw) : 0, bias, y, OH, OW);
  if (op.act === 'relu') relu(y, y);
  else if (op.act === 'relu6') for (let i = 0; i < y.length; i++) y[i] = Math.min(6, Math.max(0, y[i]));
}

/**
 * 1x1 convolution, about half of all the work. Each pass computes four
 * output channels for two pixels, so every input value loaded is used eight
 * times. Weights are [O][C].
 */
function pointwise(x, P, C, w, O, bias, y) {
  const O4 = O & ~3;
  let p = 0;
  for (; p + 1 < P; p += 2) {
    const xa = p * C, xb = xa + C, ya = p * O, yb = ya + O;
    for (let o = O4; o < O; o++) {
      let a = bias[o], b = a;
      for (let c = 0; c < C; c++) {
        a += x[xa + c] * w[o * C + c];
        b += x[xb + c] * w[o * C + c];
      }
      y[ya + o] = a;
      y[yb + o] = b;
    }
    for (let o = 0; o < O4; o += 4) {
      const w0 = o * C, w1 = w0 + C, w2 = w1 + C, w3 = w2 + C;
      let a0 = bias[o], a1 = bias[o + 1], a2 = bias[o + 2], a3 = bias[o + 3];
      let b0 = a0, b1 = a1, b2 = a2, b3 = a3;
      for (let c = 0; c < C; c++) {
        const u = x[xa + c], v = x[xb + c];
        const k0 = w[w0 + c], k1 = w[w1 + c], k2 = w[w2 + c], k3 = w[w3 + c];
        a0 += u * k0; a1 += u * k1; a2 += u * k2; a3 += u * k3;
        b0 += v * k0; b1 += v * k1; b2 += v * k2; b3 += v * k3;
      }
      y[ya + o] = a0; y[ya + o + 1] = a1; y[ya + o + 2] = a2; y[ya + o + 3] = a3;
      y[yb + o] = b0; y[yb + o + 1] = b1; y[yb + o + 2] = b2; y[yb + o + 3] = b3;
    }
  }
  for (; p < P; p++)
    for (let o = 0; o < O; o++) {
      let acc = bias[o];
      for (let c = 0; c < C; c++) acc += x[p * C + c] * w[o * C + c];
      y[p * O + o] = acc;
    }
}

/**
 * KxK convolution (only the first layer: 5x5 over 3 colour channels). Each
 * output pixel's input patch is gathered once into a contiguous, zero-padded
 * buffer in the weights' [ky][kx][c] order, then dotted with every filter.
 */
let patch = new Float32Array(0);
function spatialConv(x, H, W, C, w, O, KH, KW, sh, sw, pt, pl, bias, y, OH, OW) {
  const K = KH * KW * C;
  if (patch.length < K) patch = new Float32Array(K);
  for (let oy = 0; oy < OH; oy++)
    for (let ox = 0; ox < OW; ox++) {
      let n = 0;
      for (let ky = 0; ky < KH; ky++) {
        const iy = oy * sh - pt + ky;
        for (let kx = 0; kx < KW; kx++) {
          const ix = ox * sw - pl + kx;
          const inside = iy >= 0 && iy < H && ix >= 0 && ix < W;
          const xo = (iy * W + ix) * C;
          for (let c = 0; c < C; c++) patch[n++] = inside ? x[xo + c] : 0;
        }
      }
      const yo = (oy * OW + ox) * O;
      for (let o = 0; o < O; o++) {
        let acc = bias[o];
        const wo = o * K;
        for (let k = 0; k < K; k++) acc += patch[k] * w[wo + k];
        y[yo + o] = acc;
      }
    }
}

/**
 * Unfolds each output pixel's KxK input patch into one row ("im2col"), so a
 * KxK convolution becomes a 1x1 convolution over K*K*C channels.
 */
function unfold(x, H, W, C, KH, KW, sh, sw, pt, pl, cols, OH, OW) {
  let n = 0;
  for (let oy = 0; oy < OH; oy++)
    for (let ox = 0; ox < OW; ox++)
      for (let ky = 0; ky < KH; ky++) {
        const iy = oy * sh - pt + ky;
        for (let kx = 0; kx < KW; kx++) {
          const ix = ox * sw - pl + kx;
          const inside = iy >= 0 && iy < H && ix >= 0 && ix < W;
          const xo = (iy * W + ix) * C;
          for (let c = 0; c < C; c++) cols[n++] = inside ? x[xo + c] : 0;
        }
      }
}

/** 3x3 depthwise. Interior pixels skip the edge checks entirely. */
function depthwise(x, [, H, W, C], w, [, KH, KW], bias, y, [, OH, OW], op) {
  const sh = op.sh, sw = op.sw;
  const pt = op.same ? padBefore(H, OH, KH, sh) : 0;
  const pl = op.same ? padBefore(W, OW, KW, sw) : 0;
  for (let oy = 0; oy < OH; oy++) {
    const iy0 = oy * sh - pt;
    for (let ox = 0; ox < OW; ox++) {
      const ix0 = ox * sw - pl;
      const yo = (oy * OW + ox) * C;
      for (let c = 0; c < C; c++) y[yo + c] = bias[c];
      if (iy0 >= 0 && iy0 + KH <= H && ix0 >= 0 && ix0 + KW <= W) {
        for (let ky = 0; ky < KH; ky++)
          for (let kx = 0; kx < KW; kx++) {
            const xo = ((iy0 + ky) * W + ix0 + kx) * C, wo = (ky * KW + kx) * C;
            for (let c = 0; c < C; c++) y[yo + c] += x[xo + c] * w[wo + c];
          }
      } else {
        for (let ky = 0; ky < KH; ky++) {
          const iy = iy0 + ky;
          if (iy < 0 || iy >= H) continue;
          for (let kx = 0; kx < KW; kx++) {
            const ix = ix0 + kx;
            if (ix < 0 || ix >= W) continue;
            const xo = (iy * W + ix) * C, wo = (ky * KW + kx) * C;
            for (let c = 0; c < C; c++) y[yo + c] += x[xo + c] * w[wo + c];
          }
        }
      }
    }
  }
  if (op.act === 'relu') relu(y, y);
}

function maxpool(x, [, H, W, C], y, [, OH, OW], op) {
  const pt = op.same ? padBefore(H, OH, op.fh, op.sh) : 0;
  const pl = op.same ? padBefore(W, OW, op.fw, op.sw) : 0;
  for (let oy = 0; oy < OH; oy++)
    for (let ox = 0; ox < OW; ox++)
      for (let c = 0; c < C; c++) {
        let m = -Infinity;
        for (let ky = 0; ky < op.fh; ky++) {
          const iy = oy * op.sh - pt + ky;
          if (iy < 0 || iy >= H) continue;
          for (let kx = 0; kx < op.fw; kx++) {
            const ix = ox * op.sw - pl + kx;
            if (ix < 0 || ix >= W) continue;
            const v = x[(iy * W + ix) * C + c];
            if (v > m) m = v;
          }
        }
        y[(oy * OW + ox) * C + c] = m;
      }
}

/** BlazeFace only pads channels (zeros appended to each pixel's channel list). */
function padChannels(x, [, H, W, C], y, [, , , OC]) {
  y.fill(0);
  for (let p = 0; p < H * W; p++) y.set(x.subarray(p * C, p * C + C), p * OC);
}

function add(a, b, y, act) {
  for (let i = 0; i < y.length; i++) {
    const v = a[i] + b[i];
    y[i] = act === 'relu' && v < 0 ? 0 : v;
  }
}

function relu(x, y) {
  for (let i = 0; i < y.length; i++) y[i] = x[i] > 0 ? x[i] : 0;
}

function concat(parts, y) {
  // Every concat in this model is along axis 1 of [1, N, K]: plain append.
  let o = 0;
  for (const p of parts) {
    y.set(p, o);
    o += p.length;
  }
}
