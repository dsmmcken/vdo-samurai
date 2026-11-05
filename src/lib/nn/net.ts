// Runs a small float CNN from a .tflite file on our own WebAssembly SIMD
// kernels (kernels.wat, a few KB) instead of a full inference engine. It knows
// only the ops our two models use: BlazeFace (face/blazeface.ts) and the
// selfie segmenter (cutout/segmenter.ts).
//
// The graph is simplified first: DEQUANTIZE (weights are already float) and
// RESHAPE just alias their input; a RELU or HARD_SWISH that's the only reader
// of a conv's output is folded into that conv. All tensors then live in one
// WebAssembly memory, where intermediate results reuse freed space.

import { readTflite, type Model, type Op, type Tensor } from './tflite';

// Smallest module using a SIMD instruction: validates only where SIMD works.
const SIMD_TEST = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]);
export const simdSupported = () => typeof WebAssembly === 'object' && WebAssembly.validate(SIMD_TEST);

interface Kernels {
  pointwise(x: number, P: number, C: number, w: number, O: number, b: number, y: number, act: number): void;
  depthwise(x: number, H: number, W: number, C: number, w: number, b: number, y: number, OH: number, OW: number, s: number, pt: number, pl: number, act: number, K: number): void;
  unfold(x: number, H: number, W: number, C: number, K: number, s: number, pt: number, pl: number, y: number, OH: number, OW: number): void;
  maxpool2(x: number, H: number, W: number, C: number, y: number): void;
  padChannels(x: number, P: number, C: number, OC: number, y: number): void;
  add(x: number, z: number, y: number, n: number, relu: number): void;
  mean(x: number, P: number, C: number, y: number): void;
  scale(x: number, P: number, C: number, s: number, y: number): void;
  resize(x: number, C: number, y: number, OH: number, OW: number, rows: number, cols: number): void;
}

const ACT = { relu: 1, hardswish: 2 } as const;

export class Net {
  /** Fetches a model and the kernels, ready to run. */
  static async load(modelUrl: string, kernelsUrl: string) {
    const [model, kernels] = await Promise.all([
      fetch(modelUrl).then((r) => r.arrayBuffer()).then(readTflite),
      fetch(kernelsUrl).then((r) => r.arrayBuffer()).then((b) => WebAssembly.compile(b)),
    ]);
    return new Net(model, kernels);
  }

  /** The model's input tensors, NHWC float32, to fill before `run`. */
  readonly inputs: Float32Array[];
  /** Its outputs, valid after `run` until the next one. */
  readonly outputs: Float32Array[];
  readonly inputShapes: number[][];
  readonly outputShapes: number[][];
  private steps: (() => void)[] = [];
  /** What each step runs (op and output shape), for profiling. */
  readonly stepNames: string[] = [];

  constructor(model: Model, kernels: WebAssembly.Module) {
    const { tensors } = model;
    const size = (t: Tensor) => t.shape.reduce((a, b) => a * b, 1);
    const channels = (t: Tensor) => t.shape[t.shape.length - 1] ?? 1;

    const alias = tensors.map((_, i) => i);
    const readers = new Map<number, number>();
    for (const op of model.ops) for (const i of op.inputs) readers.set(i, (readers.get(i) ?? 0) + 1);
    const producer = new Map<number, Op>();
    const plan: Op[] = [];
    for (const op of model.ops) {
      const inputs = op.inputs.map((i) => (i < 0 ? i : alias[i]));
      const from = producer.get(inputs[0]);
      const act = op.name === 'RELU' ? 'relu' : op.name === 'HARD_SWISH' ? 'hardswish' : null;
      const folds = act === 'relu' ? ['CONV_2D', 'DEPTHWISE_CONV_2D', 'ADD'] : ['CONV_2D', 'DEPTHWISE_CONV_2D'];
      if (op.name === 'DEQUANTIZE' || op.name === 'RESHAPE') alias[op.outputs[0]] = inputs[0];
      else if (act && from && !from.act && readers.get(op.inputs[0]) === 1 && folds.includes(from.name)) {
        from.act = act;
        alias[op.outputs[0]] = inputs[0];
      } else {
        const step = { ...op, inputs };
        plan.push(step);
        producer.set(op.outputs[0], step);
      }
    }

    // One block of memory, in 16-byte aligned slots. Weights, inputs and
    // outputs keep their place; each intermediate result reuses the space of
    // one that's no longer needed. Activations get one spare pixel: the 1x1
    // kernel works on pixel pairs, so an odd count reads and writes one more.
    let top = 16;
    const bytesOf = (n: number) => Math.ceil((n * 4) / 16) * 16;
    const slot = (t: Tensor) => bytesOf(t.data ? size(t) : size(t) + channels(t)) / 4;
    const reserve = (n: number) => {
      const at = top;
      top += bytesOf(n);
      return at;
    };
    const ptr = tensors.map(() => -1);
    const fixed = new Set([...model.inputs, ...model.outputs.map((i) => alias[i])]);
    tensors.forEach((t, i) => {
      if (alias[i] === i && (t.data || fixed.has(i))) ptr[i] = reserve(slot(t));
    });
    const lastUse = new Map<number, number>();
    plan.forEach((op, s) => op.inputs.forEach((i) => lastUse.set(i, s)));
    const free: { at: number; bytes: number }[] = [];
    plan.forEach((op, s) => {
      for (const o of op.outputs) {
        if (ptr[o] >= 0) continue;
        const need = bytesOf(slot(tensors[o]));
        const fit = free.filter((f) => f.bytes >= need).sort((a, b) => a.bytes - b.bytes)[0];
        if (fit) {
          free.splice(free.indexOf(fit), 1);
          ptr[o] = fit.at;
          if (fit.bytes > need) free.push({ at: fit.at + need, bytes: fit.bytes - need });
        } else ptr[o] = reserve(slot(tensors[o]));
      }
      for (const i of op.inputs)
        if (i >= 0 && lastUse.get(i) === s && !tensors[i].data && !fixed.has(i)) free.push({ at: ptr[i], bytes: bytesOf(slot(tensors[i])) });
    });

    // Per-op extras: convs run as [K][O]-transposed weights, and a spatial
    // conv unfolds its input patches ("im2col") to use the 1x1 kernel; a
    // transposed conv is a 1x1 conv to every kernel tap, then a pixel
    // shuffle; resizing reads precomputed row and column tables.
    const extra = new Map<Op, { wT: number; cols: number; bias?: number; rows?: number }>();
    const transposed = (w: Float32Array, O: number, K: number) => {
      const O4 = Math.ceil(O / 4) * 4;
      const wT = new Float32Array(K * O4);
      for (let o = 0; o < O; o++) for (let i = 0; i < K; i++) wT[i * O4 + o] = w[o * K + i];
      return wT;
    };
    const init: [number, Float32Array | Int32Array][] = [];
    for (const op of plan) {
      if (op.name === 'CONV_2D') {
        const [O, KH, KW, C] = tensors[op.inputs[1]].shape;
        const [, OH, OW] = tensors[op.outputs[0]].shape;
        const spatial = KH > 1 || KW > 1 || op.sw! > 1;
        const wT = reserve(KH * KW * C * Math.ceil(O / 4) * 4);
        init.push([wT, transposed(tensors[op.inputs[1]].data as Float32Array, O, KH * KW * C)]);
        extra.set(op, { wT, cols: spatial ? reserve(OH * OW * KH * KW * C) : -1 });
      } else if (op.name === 'Convolution2DTransposeBias') {
        // Weights [O][KH][KW][C] become a 1x1 conv to O' = KH*KW*O channels,
        // ordered (ky, kx, o), with the bias repeated for each tap.
        const [O, KH, KW, C] = tensors[op.inputs[1]].shape;
        const w = tensors[op.inputs[1]].data as Float32Array;
        const b = tensors[op.inputs[2]].data as Float32Array;
        const T = KH * KW;
        const w2 = new Float32Array(T * O * C);
        const b2 = new Float32Array(Math.ceil((T * O) / 4) * 4 + 4);
        for (let t = 0; t < T; t++)
          for (let o = 0; o < O; o++) {
            b2[t * O + o] = b[o];
            for (let c = 0; c < C; c++) w2[(t * O + o) * C + c] = w[(o * T + t) * C + c];
          }
        const [, H, W] = tensors[op.inputs[0]].shape;
        const wT = reserve(C * Math.ceil((T * O) / 4) * 4);
        const bias = reserve(b2.length);
        init.push([wT, transposed(w2, T * O, C)], [bias, b2]);
        extra.set(op, { wT, bias, cols: reserve((H * W + 1) * T * O) });
      } else if (op.name === 'RESIZE_BILINEAR') {
        const [, H, W, C] = tensors[op.inputs[0]].shape;
        const [, OH, OW] = tensors[op.outputs[0]].shape;
        // TFLite's sampling grid: corners aligned, pixel centres, or neither.
        const grid = (n: number, out: number, stride: number) => {
          const t = new Int32Array(out * 3);
          const f = new Float32Array(t.buffer);
          const s = op.alignCorners && out > 1 ? (n - 1) / (out - 1) : n / out;
          for (let i = 0; i < out; i++) {
            const v = op.halfPixel ? (i + 0.5) * s - 0.5 : i * s;
            const lo = Math.max(Math.floor(v), 0);
            const hi = Math.min(Math.ceil(v), n - 1);
            t[i * 3] = lo * stride;
            t[i * 3 + 1] = hi * stride;
            f[i * 3 + 2] = hi === lo ? 0 : v - lo;
          }
          return t;
        };
        const rows = reserve(OH * 3);
        const cols = reserve(OW * 3);
        init.push([rows, grid(H, OH, W * C * 4)], [cols, grid(W, OW, C * 4)]);
        extra.set(op, { wT: -1, rows, cols });
      }
    }

    const mem = new WebAssembly.Memory({ initial: Math.ceil((top + 64) / 65536) }); // +64: a bias vector may read past its end
    const k = new WebAssembly.Instance(kernels, { env: { mem } }).exports as unknown as Kernels;
    const P = ptr.map((_, i) => ptr[alias[i]]);
    const view = (i: number) => new Float32Array(mem.buffer, P[i], size(tensors[i]));
    tensors.forEach((t, i) => {
      if (!t.data || P[i] < 0) return;
      if (t.data instanceof Int32Array) new Int32Array(mem.buffer, P[i], t.data.length).set(t.data);
      else view(i).set(t.data);
    });
    for (const [at, data] of init) (data instanceof Int32Array ? new Int32Array(mem.buffer, at, data.length) : new Float32Array(mem.buffer, at, data.length)).set(data);

    const shape = (i: number) => tensors[i].shape;
    const padBefore = (inSize: number, outSize: number, kk: number, s: number) => Math.floor(Math.max((outSize - 1) * s + kk - inSize, 0) / 2);
    const fail = (op: Op, why = '') => new Error(`nn: unsupported ${op.name}${why ? ` (${why})` : ''}`);
    const f32 = () => new Float32Array(mem.buffer);
    for (const op of plan) {
      const [a, b, c] = op.inputs;
      const out = op.outputs[0];
      if (op.act === 'relu6') throw fail(op, 'relu6');
      const act = op.act ? ACT[op.act] : 0;
      const [, H, W, C] = shape(a);
      const [, OH, OW, OC] = shape(out);
      const even = (n: number) => n + (n % 2);
      switch (op.name) {
        case 'CONV_2D': {
          const [O, KH, KW] = shape(b);
          const e = extra.get(op)!;
          if (e.cols < 0) this.steps.push(() => k.pointwise(P[a], even(H * W), C, e.wT, O, P[c], P[out], act));
          else {
            if (KH !== KW || op.sh !== op.sw || (OH * OW) % 2) throw fail(op);
            const pt = op.same ? padBefore(H, OH, KH, op.sh!) : 0;
            const pl = op.same ? padBefore(W, OW, KW, op.sw!) : 0;
            this.steps.push(() => {
              k.unfold(P[a], H, W, C, KH, op.sh!, pt, pl, e.cols, OH, OW);
              k.pointwise(e.cols, OH * OW, KH * KW * C, e.wT, O, P[c], P[out], act);
            });
          }
          break;
        }
        case 'DEPTHWISE_CONV_2D': {
          const [, KH, KW] = shape(b);
          if (KH !== KW || op.sh !== op.sw) throw fail(op);
          const pt = op.same ? padBefore(H, OH, KH, op.sh!) : 0;
          const pl = op.same ? padBefore(W, OW, KW, op.sw!) : 0;
          this.steps.push(() => k.depthwise(P[a], H, W, C, P[b], P[c], P[out], OH, OW, op.sh!, pt, pl, act, KH));
          break;
        }
        case 'MAX_POOL_2D':
          if (op.fw !== 2 || op.fh !== 2 || op.sw !== 2 || op.sh !== 2 || H % 2 || W % 2) throw fail(op);
          this.steps.push(() => k.maxpool2(P[a], H, W, C, P[out]));
          break;
        case 'AVERAGE_POOL_2D':
          // Only global pooling (squeeze-and-excite blocks).
          if (OH !== 1 || OW !== 1 || op.fh !== H || op.fw !== W || C % 4) throw fail(op, 'not global');
          this.steps.push(() => k.mean(P[a], H * W, C, P[out]));
          break;
        case 'PAD': {
          // Only appending channels (BlazeFace).
          const pads = tensors[b].data as Int32Array;
          if (pads.slice(0, 7).some((p) => p !== 0)) throw fail(op);
          this.steps.push(() => k.padChannels(P[a], H * W, C, OC, P[out]));
          break;
        }
        case 'ADD': {
          const n = size(tensors[out]);
          if (n % 4 || size(tensors[a]) !== size(tensors[b])) throw fail(op);
          this.steps.push(() => k.add(P[a], P[b], P[out], n, act));
          break;
        }
        case 'MUL': {
          // Only scaling channels by a per-channel vector (squeeze-and-excite).
          const s = shape(b);
          if (size(tensors[b]) !== C || s[s.length - 1] !== C || C % 4 || act) throw fail(op);
          this.steps.push(() => k.scale(P[a], H * W, C, P[b], P[out]));
          break;
        }
        case 'LOGISTIC': {
          const n = size(tensors[out]);
          this.steps.push(() => {
            const f = f32();
            const x = P[a] / 4;
            const y = P[out] / 4;
            for (let i = 0; i < n; i++) f[y + i] = 1 / (1 + Math.exp(-f[x + i]));
          });
          break;
        }
        case 'RESIZE_BILINEAR': {
          if (C % 4) throw fail(op);
          const e = extra.get(op)!;
          this.steps.push(() => k.resize(P[a], C, P[out], OH, OW, e.rows!, e.cols));
          break;
        }
        case 'Convolution2DTransposeBias': {
          // MediaPipe's op; its options are a C struct: padding, stride w, stride h.
          const [O, KH, KW] = shape(b);
          const o = op.custom && new DataView(op.custom.buffer, op.custom.byteOffset, op.custom.byteLength);
          const [sw, sh] = o && o.byteLength >= 12 ? [o.getInt32(4, true), o.getInt32(8, true)] : [0, 0];
          if (sw !== KW || sh !== KH || OH !== H * KH || OW !== W * KW) throw fail(op, 'only non-overlapping taps');
          const e = extra.get(op)!;
          const T = KH * KW * O;
          this.steps.push(() => {
            k.pointwise(P[a], even(H * W), C, e.wT, T, e.bias!, e.cols, 0);
            // Pixel shuffle: tap (ky, kx) of input pixel (y, x) lands on (y*KH+ky, x*KW+kx).
            const f = f32();
            const src = e.cols / 4;
            const dst = P[out] / 4;
            for (let y = 0; y < H; y++)
              for (let x = 0; x < W; x++) {
                const s0 = src + (y * W + x) * T;
                for (let ky = 0; ky < KH; ky++)
                  for (let kx = 0; kx < KW; kx++) {
                    const d = dst + ((y * KH + ky) * OW + x * KW + kx) * O;
                    const s = s0 + (ky * KW + kx) * O;
                    for (let q = 0; q < O; q++) f[d + q] = f[s + q];
                  }
              }
          });
          break;
        }
        case 'CONCATENATION': {
          // [1, N, K] along axis 1: a plain append.
          if (op.axis !== 1) throw fail(op);
          const parts = op.inputs.map((i) => [P[i], size(tensors[i])] as const);
          this.steps.push(() => {
            const f = f32();
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
      while (this.stepNames.length < this.steps.length) this.stepNames.push(`${op.name}${op.act ? `+${op.act}` : ''} ${shape(out).join('x')}`);
    }
    this.inputs = model.inputs.map(view);
    this.outputs = model.outputs.map((i) => view(alias[i]));
    this.inputShapes = model.inputs.map(shape);
    this.outputShapes = model.outputs.map(shape);
  }

  run() {
    for (const step of this.steps) step();
  }
}
