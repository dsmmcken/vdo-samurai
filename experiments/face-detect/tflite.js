// Minimal reader for the parts of a .tflite file (a FlatBuffer) that a small
// float CNN needs: tensors, their weights, and the operator list. Field
// numbers follow tensorflow/lite/schema/schema.fbs.

const OPS = { 0: 'ADD', 1: 'AVERAGE_POOL_2D', 2: 'CONCATENATION', 3: 'CONV_2D', 4: 'DEPTHWISE_CONV_2D', 6: 'DEQUANTIZE', 17: 'MAX_POOL_2D', 19: 'RELU', 21: 'RELU6', 22: 'RESHAPE', 34: 'PAD', 14: 'LOGISTIC' };
const ACT = { 0: null, 1: 'relu', 3: 'relu6' };

class Table {
  constructor(view, pos) {
    this.v = view;
    this.pos = pos;
    this.vt = pos - view.getInt32(pos, true);
    this.vtLen = view.getUint16(this.vt, true);
  }
  off(field) {
    const o = 4 + field * 2;
    return o < this.vtLen ? this.v.getUint16(this.vt + o, true) : 0;
  }
  u8(f, d = 0) { const o = this.off(f); return o ? this.v.getUint8(this.pos + o) : d; }
  i32(f, d = 0) { const o = this.off(f); return o ? this.v.getInt32(this.pos + o, true) : d; }
  u32(f, d = 0) { const o = this.off(f); return o ? this.v.getUint32(this.pos + o, true) : d; }
  ref(f) { const o = this.off(f); return o ? this.pos + o + this.v.getUint32(this.pos + o, true) : 0; }
  table(f) { const p = this.ref(f); return p ? new Table(this.v, p) : null; }
  tables(f) {
    const p = this.ref(f);
    if (!p) return [];
    const n = this.v.getUint32(p, true);
    return Array.from({ length: n }, (_, i) => new Table(this.v, p + 4 + i * 4 + this.v.getUint32(p + 4 + i * 4, true)));
  }
  ints(f) {
    const p = this.ref(f);
    if (!p) return [];
    return Array.from({ length: this.v.getUint32(p, true) }, (_, i) => this.v.getInt32(p + 4 + i * 4, true));
  }
  bytes(f) {
    const p = this.ref(f);
    return p ? new Uint8Array(this.v.buffer, this.v.byteOffset + p + 4, this.v.getUint32(p, true)) : null;
  }
  str(f) { const b = this.bytes(f); return b ? new TextDecoder().decode(b) : ''; }
}

function half(h) {
  const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 31, m = h & 1023;
  if (e === 0) return s * 2 ** -14 * (m / 1024);
  if (e === 31) return m ? NaN : s * Infinity;
  return s * 2 ** (e - 15) * (1 + m / 1024);
}

/** Parses a .tflite file into { tensors, ops, inputs, outputs }. Weights come back as Float32Array. */
export function readTflite(arrayBuffer) {
  const v = new DataView(arrayBuffer);
  const model = new Table(v, v.getUint32(0, true));
  const codes = model.tables(1).map((c) => Math.max(c.u8(0), c.i32(3)));
  const buffers = model.tables(4);
  const g = model.tables(2)[0];
  const tensors = g.tables(0).map((t) => {
    const type = t.u8(1);
    const raw = buffers[t.u32(2)]?.bytes(0);
    let data = null;
    if (raw && raw.length) {
      const copy = raw.slice().buffer; // aligned
      if (type === 0) data = new Float32Array(copy);
      else if (type === 1) data = Float32Array.from(new Uint16Array(copy), half);
      else if (type === 2) data = new Int32Array(copy);
      else throw new Error(`tensor type ${type} not supported`);
    }
    return { name: t.str(3), shape: t.ints(0), type, data };
  });
  const ops = g.tables(3).map((o) => {
    const code = codes[o.u32(0)];
    const name = OPS[code] ?? `op${code}`;
    const b = o.table(4);
    let opt = {};
    if (b) {
      if (name === 'CONV_2D') opt = { same: b.u8(0) === 0, sw: b.i32(1), sh: b.i32(2), act: ACT[b.u8(3)] };
      else if (name === 'DEPTHWISE_CONV_2D') opt = { same: b.u8(0) === 0, sw: b.i32(1), sh: b.i32(2), act: ACT[b.u8(4)] };
      else if (name === 'MAX_POOL_2D' || name === 'AVERAGE_POOL_2D') opt = { same: b.u8(0) === 0, sw: b.i32(1), sh: b.i32(2), fw: b.i32(3), fh: b.i32(4), act: ACT[b.u8(5)] };
      else if (name === 'ADD') opt = { act: ACT[b.u8(0)] };
      else if (name === 'CONCATENATION') opt = { axis: b.i32(0), act: ACT[b.u8(1)] };
    }
    return { name, inputs: o.ints(1), outputs: o.ints(2), ...opt };
  });
  return { tensors, ops, inputs: g.ints(1), outputs: g.ints(2) };
}
