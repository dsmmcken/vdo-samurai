// Encodes the live screen share once, for every viewer (see screencast.ts).
//
// AV1 in constant-quality mode with the 'text' content hint, which turns on
// the encoder's screen tools: scrolling code costs ~0.4 Mbps instead of ~11.
// Moving content goes out at a middling quantizer; once the picture has been
// still for a moment, the same frame is sent again as a sharp key frame (the
// "settle"), and the small changes after it (a caret, a typed word) are cheap
// deltas on top of that sharp picture. Measured in experiments/screen-share.
import { CAST_CODEC } from './screencast';

export type CastIn =
  | { t: 'start'; video: ReadableStream<VideoFrame> }
  | { t: 'live'; on: boolean }
  | { t: 'key' }
  | { t: 'stop' };
export type CastOut = { t: 'chunk'; key: boolean; ts: number; w: number; h: number; data: ArrayBuffer } | { t: 'warn'; message: string };

const FPS = 12;
const Q_MOVING = 40; // AV1 quantizer, 0 (best) .. 63
const Q_MAX = 56;
const Q_SETTLED = 10;
const SETTLE_MS = 400; // still this long before sharpening
const SETTLE_AREA = 0.002; // ...if at least this much of the picture changed since the last sharp frame
const SETTLE_GAP_MS = 1500; // and at most this often
const BUDGET_BPS = 2_500_000; // moving content; above it, coarser and then fewer frames

const post = (m: CastOut, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(m, transfer);

let live = false;
let wantKey = true;
let latest: VideoFrame | null = null;
let fresh = false;
let reader: ReadableStreamDefaultReader<VideoFrame> | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

self.onmessage = (e: MessageEvent<CastIn>) => {
  const m = e.data;
  if (m.t === 'start') start(m.video);
  else if (m.t === 'live') {
    if (m.on && !live) wantKey = true;
    live = m.on;
  } else if (m.t === 'key') wantKey = true;
  else if (m.t === 'stop') stop();
};

// ---- stillness: a small grey thumbnail of each frame we look at

const TW = 160, TH = 90;
const thumbCanvas = new OffscreenCanvas(TW, TH);
const thumbCtx = thumbCanvas.getContext('2d', { willReadFrequently: true })!;
function thumb(f: VideoFrame) {
  thumbCtx.drawImage(f, 0, 0, TW, TH);
  const d = thumbCtx.getImageData(0, 0, TW, TH).data;
  const t = new Uint8Array(TW * TH);
  for (let i = 0; i < t.length; i++) t[i] = (d[i * 4] * 77 + d[i * 4 + 1] * 150 + d[i * 4 + 2] * 29) >> 8;
  return t;
}
/** Share of thumbnail pixels that differ visibly. */
function changed(a: Uint8Array | null, b: Uint8Array) {
  if (!a) return 1;
  let n = 0;
  for (let i = 0; i < b.length; i++) if (Math.abs(a[i] - b[i]) > 2) n++;
  return n / b.length;
}

// ---- encoding

let encoder: VideoEncoder | null = null;
let size = { w: 0, h: 0 };
let q = Q_MOVING;
let lastThumb: Uint8Array | null = null; // last frame encoded
let keyThumb: Uint8Array | null = null; // last sharp (settled) frame
let lastChange = 0;
let lastSettle = 0;
let settled = false;
let skip = false; // over budget at the coarsest quantizer: every other frame
const recent: { at: number; bytes: number }[] = [];

function configure(w: number, h: number) {
  encoder?.close();
  size = { w, h };
  encoder = new VideoEncoder({
    output: (chunk) => {
      const data = new ArrayBuffer(chunk.byteLength);
      chunk.copyTo(data);
      if (chunk.type === 'delta') recent.push({ at: performance.now(), bytes: data.byteLength });
      post({ t: 'chunk', key: chunk.type === 'key', ts: chunk.timestamp, w: size.w, h: size.h, data }, [data]);
    },
    error: (e) => {
      post({ t: 'warn', message: `screen encoder: ${e.message}` });
      encoder = null; // rebuilt on the next frame
    },
  });
  encoder.configure({ codec: CAST_CODEC, width: w, height: h, bitrateMode: 'quantizer', latencyMode: 'realtime', contentHint: 'text' } as VideoEncoderConfig);
  wantKey = true;
}

function encode(f: VideoFrame, key: boolean, quantizer: number) {
  // Even sizes keep every encoder happy.
  const w = f.displayWidth & ~1, h = f.displayHeight & ~1;
  if (!encoder || w !== size.w || h !== size.h) configure(w, h), (key = true);
  encoder!.encode(f, { keyFrame: key || wantKey, av1: { quantizer } } as VideoEncoderEncodeOptions);
  wantKey = false;
}

/** Coarser while moving content runs over budget, finer again when it doesn't. */
function rateControl(now: number) {
  while (recent.length && recent[0].at < now - 1000) recent.shift();
  const bps = recent.reduce((a, r) => a + r.bytes, 0) * 8;
  if (bps > BUDGET_BPS) {
    if (q < Q_MAX) q = Math.min(Q_MAX, q + 4);
    else skip = !skip;
  } else {
    skip = false;
    if (bps < BUDGET_BPS * 0.4 && q > Q_MOVING) q -= 2;
  }
}

function tick() {
  const f = latest;
  if (!live || !f || (encoder && encoder.encodeQueueSize > 1)) return;
  const now = performance.now();
  if (fresh) {
    fresh = false;
    const t = thumb(f);
    const moved = changed(lastThumb, t);
    // A capture that redelivers an identical picture counts as still.
    if (moved > 0 || wantKey) {
      rateControl(now);
      if (moved > 0) {
        lastThumb = t;
        lastChange = now;
        settled = false;
      }
      if (skip && !wantKey) return;
      encode(f, false, wantKey && settled ? Q_SETTLED : q);
      return;
    }
  }
  if (!lastThumb) return;
  // Still: sharpen once, if enough changed since the last sharp frame.
  if (!settled && now - lastChange >= SETTLE_MS && now - lastSettle >= SETTLE_GAP_MS) {
    settled = true;
    if (changed(keyThumb, lastThumb) >= SETTLE_AREA) {
      keyThumb = lastThumb;
      lastSettle = now;
      encode(f, true, Q_SETTLED);
      return;
    }
  }
  // A viewer asked for a fresh start while nothing moves.
  if (wantKey) encode(f, true, settled ? Q_SETTLED : q);
}

async function start(video: ReadableStream<VideoFrame>) {
  reader = video.getReader();
  timer = setInterval(tick, 1000 / FPS);
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      latest?.close();
      latest = value;
      fresh = true;
    }
  } catch {
    /* stopped */
  }
}

function stop() {
  if (timer) clearInterval(timer);
  reader?.cancel().catch(() => {});
  latest?.close();
  latest = null;
  if (encoder?.state === 'configured') encoder.close();
  encoder = null;
}
