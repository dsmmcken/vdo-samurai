// Live screen share, encoded once for everyone.
//
// WebRTC encodes a track separately for every peer connection, so in our mesh a
// sharp screen costs one encoder per viewer. Instead the sharer runs one AV1
// encoder (screencast-worker.ts) and sends the same encoded frames to each
// viewer over a data channel, where WebCodecs decodes them onto a canvas whose
// stream the stage shows like any other video.
//
// Data channels are reliable and ordered, so nothing is lost; a viewer whose
// channel backs up skips ahead to the next key frame instead.
// Peers that can't take part (no WebCodecs AV1 on either side) get the screen
// as a normal WebRTC track, as before.
import type { CastIn, CastOut } from './screencast-worker';

export const CAST_CODEC = 'av01.0.08M.08'; // AV1 main, level 4.0: up to 2048x1152

/** Each message: a header, then one piece of an encoded frame. */
const HEADER = 20; // flags u8, part u8, parts u8, -, seq u32, width u16, height u16, timestamp f64
const PIECE = 60_000; // under every browser's data channel message limit
/** A viewer whose channel holds more than this skips to the next key frame. */
const BACKLOG = 1_500_000;
/**
 * A viewer with more frames than this waiting to decode is showing the past
 * (a stalled channel flushing at once, say): it skips to a fresh key frame
 * instead of replaying them all.
 */
const BEHIND = 12;

const hasProcessor = () => typeof (globalThis as any).MediaStreamTrackProcessor !== 'undefined';

let support: Promise<{ send: boolean; receive: boolean }> | null = null;
/** Whether this browser can send / receive the encoded screen. */
export function castSupport() {
  return (support ??= (async () => {
    const yes = async (p: Promise<{ supported?: boolean; config?: any }> | undefined, check = (_: any) => true) => {
      try {
        const r = await p;
        return !!r?.supported && check(r.config);
      } catch {
        return false;
      }
    };
    const send =
      hasProcessor() &&
      typeof VideoEncoder !== 'undefined' &&
      (await yes(
        VideoEncoder.isConfigSupported({ codec: CAST_CODEC, width: 1920, height: 1080, bitrateMode: 'quantizer', latencyMode: 'realtime', contentHint: 'text' } as VideoEncoderConfig),
        // Without the screen tools that the hint turns on, scrolling costs ~30x more.
        (c) => c?.contentHint === 'text',
      ));
    const receive = typeof VideoDecoder !== 'undefined' && (await yes(VideoDecoder.isConfigSupported({ codec: CAST_CODEC, optimizeForLatency: true })));
    return { send, receive };
  })());
}

// ------------------------------------------------------------------ sharer

type Viewer = {
  ch: RTCDataChannel;
  needKey: boolean;
  /** Skipping because its channel backed up (not just waiting for a first key frame). */
  backlogged: boolean;
  sentSeq: number;
  bytes: number;
  skips: number;
  lastSendAt: number;
};

/** Seconds since a performance.now() time, for logs. */
const ago = (t: number) => (t ? `${((performance.now() - t) / 1000).toFixed(1)} s ago` : 'never');
const kb = (n: number) => `${Math.round(n / 1024)} KB`;

export class ScreenCaster {
  private worker = new Worker(new URL('./screencast-worker.ts', import.meta.url), { type: 'module' });
  private clone: MediaStreamTrack;
  private viewers = new Map<string, Viewer>();
  private seq = 0;
  private live = false;
  /** Bytes handed to the channels, for the e2e test and debugging. */
  sent = 0;
  private beatTimer: ReturnType<typeof setInterval>;

  constructor(
    track: MediaStreamTrack,
    /** Notable events, for the connection details. */
    private log: (line: string) => void = () => {},
    /** Once a second while live, per viewer: the newest frame made, so a viewer can tell a stall from a still screen. */
    private beat: (peer: string, m: { seq: number; skipping: boolean }) => void = () => {},
  ) {
    this.clone = track.clone();
    this.beatTimer = setInterval(() => {
      if (this.live) for (const [id, v] of this.viewers) this.beat(id, { seq: this.seq - 1, skipping: v.needKey });
    }, 1000);
    const video = new (globalThis as any).MediaStreamTrackProcessor({ track: this.clone }).readable;
    this.worker.onmessage = (e: MessageEvent<CastOut>) => {
      const m = e.data;
      if (m.t === 'chunk') this.fanOut(m);
      else console.warn('[screencast]', m.message);
    };
    this.post({ t: 'start', video }, [video]);
  }

  private post(m: CastIn, transfer: Transferable[] = []) {
    this.worker.postMessage(m, transfer);
  }

  /** Who gets the frames (by peer id), and whether anyone should be getting them at all. */
  update(channels: Map<string, RTCDataChannel>, live: boolean) {
    for (const [id, v] of this.viewers) if (channels.get(id) !== v.ch) this.viewers.delete(id);
    for (const [id, ch] of channels) {
      if (this.viewers.has(id)) continue;
      const v: Viewer = { ch, needKey: true, backlogged: false, sentSeq: -1, bytes: 0, skips: 0, lastSendAt: 0 };
      this.viewers.set(id, v);
      // Caught up again after a backlog: start over from a key frame.
      ch.bufferedAmountLowThreshold = BACKLOG / 4;
      ch.addEventListener('bufferedamountlow', () => {
        if (!v.needKey) return;
        if (v.backlogged) this.log(`${id}: channel drained, sending a key frame`);
        v.backlogged = false;
        this.post({ t: 'key' });
      });
      if (ch.readyState !== 'open') ch.addEventListener('open', () => this.requestKey(id), { once: true });
      else if (this.live) this.post({ t: 'key' });
    }
    live &&= this.viewers.size > 0;
    if (live !== this.live) {
      this.live = live;
      if (live) for (const v of this.viewers.values()) v.needKey = true;
      this.post({ t: 'live', on: live });
    }
  }

  /** A viewer lost its place (decoder error, reconnect). */
  requestKey(peer: string) {
    const v = this.viewers.get(peer);
    if (!v) return;
    v.needKey = true;
    this.post({ t: 'key' });
  }

  private fanOut(m: Extract<CastOut, { t: 'chunk' }>) {
    const seq = this.seq++;
    const pieces: ArrayBuffer[] = [];
    const parts = Math.max(1, Math.ceil(m.data.byteLength / PIECE));
    for (let i = 0; i < parts; i++) {
      const body = new Uint8Array(m.data, i * PIECE, Math.min(PIECE, m.data.byteLength - i * PIECE));
      const buf = new ArrayBuffer(HEADER + body.byteLength);
      const dv = new DataView(buf);
      dv.setUint8(0, m.key ? 1 : 0);
      dv.setUint8(1, i);
      dv.setUint8(2, parts);
      dv.setUint32(4, seq);
      dv.setUint16(8, m.w);
      dv.setUint16(10, m.h);
      dv.setFloat64(12, m.ts);
      new Uint8Array(buf, HEADER).set(body);
      pieces.push(buf);
    }
    for (const [id, v] of this.viewers) {
      if (v.ch.readyState !== 'open') continue;
      if (v.needKey && !m.key) continue;
      if (v.ch.bufferedAmount > BACKLOG) {
        if (!v.backlogged) this.log(`${id}: ${kb(v.ch.bufferedAmount)} queued (last send ${ago(v.lastSendAt)}), skipping until it drains`);
        v.needKey = true; // the bufferedamountlow handler asks for a key frame once it drains
        v.backlogged = true;
        v.skips++;
        continue;
      }
      v.needKey = false;
      try {
        for (const p of pieces) v.ch.send(p);
        this.sent += m.data.byteLength;
        v.bytes += m.data.byteLength;
        v.sentSeq = seq;
        v.lastSendAt = performance.now();
      } catch (e) {
        this.log(`${id}: send failed (${e}), waiting for a key frame`);
        v.needKey = true;
      }
    }
  }

  /** For the connection details. */
  state(name: (id: string) => string): string[] {
    const lines = [`encoder ${this.live ? 'live (on stage)' : 'idle (not on stage)'}, ${this.seq} frames made, ${kb(this.sent)} sent in all`];
    for (const [id, v] of this.viewers)
      lines.push(`  to ${name(id)}: channel ${v.ch.readyState}, ${kb(v.ch.bufferedAmount)} queued, ${v.needKey ? (v.backlogged ? 'SKIPPING (backlog)' : 'waiting for a key frame') : 'in sync'}, sent up to #${v.sentSeq} (${kb(v.bytes)}), last send ${ago(v.lastSendAt)}, backlog skips ${v.skips}`);
    if (!this.viewers.size) lines.push('  no viewers taking it encoded-once');
    return lines;
  }

  stop() {
    clearInterval(this.beatTimer);
    this.post({ t: 'stop' });
    this.clone.stop();
    setTimeout(() => this.worker.terminate(), 500);
  }
}

// ------------------------------------------------------------------ viewer

/** One remote screen: frames in, a MediaStream out. */
export class ScreenView {
  readonly stream: MediaStream;
  private canvas = document.createElement('canvas');
  private ctx = this.canvas.getContext('2d')!;
  private track: CanvasCaptureMediaStreamTrack;
  private decoder: VideoDecoder | null = null;
  private size = { w: 0, h: 0 };
  private waitKey = true;
  private lastSeq = -1;
  private parts: Uint8Array[] = [];
  private closed = false;
  private asked = 0;
  /** Frames shown, for the e2e test. */
  frames = 0;
  private lastFrameAt = 0;
  private lastDataAt = 0;
  private bytes = 0;
  private asks = 0;
  private skips = 0;
  private errors = 0;
  /** The sharer's newest frame, from its heartbeat; since when we've been behind it. */
  private sharerSeq = -1;
  private behindSince: number | null = null;
  private behindLogged = false;
  private lastBeatAt = 0;
  private beatLost = false;

  constructor(
    private askKey: () => void,
    /** Notable events, for the connection details. */
    private log: (line: string) => void = () => {},
  ) {
    this.canvas.width = 1920;
    this.canvas.height = 1080;
    this.stream = this.canvas.captureStream(0);
    this.track = this.stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;
  }

  receive(buf: ArrayBuffer) {
    if (this.closed) return;
    this.lastDataAt = performance.now();
    this.bytes += buf.byteLength;
    const dv = new DataView(buf);
    const key = (dv.getUint8(0) & 1) === 1, part = dv.getUint8(1), parts = dv.getUint8(2), seq = dv.getUint32(4);
    if (part === 0) {
      // The sharer skips frames for a viewer that's behind, and restarts on a key frame.
      if (seq !== this.lastSeq + 1 && !key) this.lost(`frames ${this.lastSeq + 1}..${seq - 1} missing`);
      this.lastSeq = seq;
      this.parts = [];
    } else if (seq !== this.lastSeq || part !== this.parts.length) return this.lost('piece out of order');
    this.parts.push(new Uint8Array(buf, HEADER));
    if (this.parts.length < parts) return;
    const data = new Uint8Array(this.parts.reduce((a, p) => a + p.byteLength, 0));
    let at = 0;
    for (const p of this.parts) data.set(p, at), (at += p.byteLength);
    this.parts = [];
    this.decode(key, dv.getUint16(8), dv.getUint16(10), dv.getFloat64(12), data);
  }

  private decode(key: boolean, w: number, h: number, ts: number, data: Uint8Array) {
    if (this.waitKey && !key) return this.ask();
    if (key && (!this.decoder || this.decoder.state !== 'configured' || w !== this.size.w || h !== this.size.h)) {
      this.decoder?.state === 'configured' && this.decoder.close();
      this.size = { w, h };
      this.decoder = new VideoDecoder({
        output: (f) => this.show(f),
        error: (e) => {
          console.warn('[screencast] decode failed', e.message);
          this.errors++;
          this.lost(`decoder error: ${e.message}`);
        },
      });
      // Without optimizeForLatency the decoder holds a few frames back.
      this.decoder.configure({ codec: CAST_CODEC, codedWidth: w, codedHeight: h, optimizeForLatency: true });
    }
    if (!this.decoder || this.decoder.state !== 'configured') return;
    if (this.decoder.decodeQueueSize > BEHIND) {
      // Behind: drop what's queued; the next key frame starts a new decoder.
      const queued = this.decoder.decodeQueueSize;
      this.decoder.close();
      this.decoder = null;
      this.skips++;
      return this.lost(`${queued} frames waiting to decode, skipping ahead`);
    }
    this.waitKey = false;
    try {
      this.decoder.decode(new EncodedVideoChunk({ type: key ? 'key' : 'delta', timestamp: ts, data }));
    } catch (e) {
      this.lost(`decode threw: ${e}`);
    }
  }

  private show(f: VideoFrame) {
    if (this.closed) return f.close();
    if (this.canvas.width !== f.displayWidth || this.canvas.height !== f.displayHeight) {
      this.canvas.width = f.displayWidth;
      this.canvas.height = f.displayHeight;
    }
    this.ctx.drawImage(f, 0, 0);
    f.close();
    this.frames++;
    this.lastFrameAt = performance.now();
    this.track.requestFrame();
  }

  /** Out of step: drop everything until the next key frame, and ask for one. */
  private lost(why: string) {
    if (!this.waitKey) this.log(`lost sync (${why}), waiting for a key frame`);
    this.waitKey = true;
    this.parts = [];
    this.ask();
  }

  private ask() {
    const t = performance.now();
    if (t - this.asked < 1000) return;
    this.asked = t;
    this.asks++;
    this.askKey();
  }

  /** The sharer's heartbeat: behind it for 2 s or more is a stall (a still screen sends nothing, and isn't one). */
  heartbeat(seq: number, skipping: boolean) {
    this.sharerSeq = seq;
    const t = performance.now();
    if (this.beatLost) this.log(`heartbeat back after ${((t - this.lastBeatAt) / 1000).toFixed(1)} s`);
    this.beatLost = false;
    this.lastBeatAt = t;
    if (seq > this.lastSeq) {
      this.behindSince ??= t;
      if (!this.behindLogged && t - this.behindSince >= 2000) {
        this.behindLogged = true;
        this.log(`STALLED: sharer at frame #${seq}, we have #${this.lastSeq}${skipping ? ' (sharer is skipping to a key frame for us)' : ''}; last data ${ago(this.lastDataAt)}, last frame shown ${ago(this.lastFrameAt)}`);
      }
    } else {
      if (this.behindLogged && this.behindSince !== null) this.log(`caught up after ${((t - this.behindSince) / 1000).toFixed(1)} s`);
      this.behindSince = null;
      this.behindLogged = false;
    }
  }

  /**
   * While their screen is on stage (since `since`), a sharer that has sent heartbeats
   * sends one a second: none for 3 s means the whole link is stalled, control
   * channel included (so the heartbeat can't say so itself).
   */
  checkBeat(since: number) {
    if (!this.lastBeatAt || this.beatLost) return;
    const quiet = performance.now() - Math.max(this.lastBeatAt, since);
    if (quiet < 3000) return;
    this.beatLost = true;
    this.log(`STALLED: no heartbeat from the sharer for ${(quiet / 1000).toFixed(1)} s; last data ${ago(this.lastDataAt)}, last frame shown ${ago(this.lastFrameAt)}`);
  }

  /** For the connection details. */
  state() {
    const d = this.decoder;
    return `${this.frames} frames shown, last ${ago(this.lastFrameAt)}; last data ${ago(this.lastDataAt)}, ${kb(this.bytes)} in; ${this.waitKey ? 'WAITING FOR A KEY FRAME' : 'in sync'} at #${this.lastSeq} (sharer #${this.sharerSeq}${this.behindSince !== null ? `, behind for ${((performance.now() - this.behindSince) / 1000).toFixed(1)} s` : ''}); decoder ${d ? `${d.state}, ${d.decodeQueueSize} queued` : 'none'}; key asks ${this.asks}, skip-aheads ${this.skips}, decoder errors ${this.errors}`;
  }

  close() {
    this.closed = true;
    if (this.decoder?.state === 'configured') this.decoder.close();
    this.track.stop();
  }
}
