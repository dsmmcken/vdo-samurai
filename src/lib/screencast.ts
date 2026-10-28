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

type Viewer = { ch: RTCDataChannel; needKey: boolean };

export class ScreenCaster {
  private worker = new Worker(new URL('./screencast-worker.ts', import.meta.url), { type: 'module' });
  private clone: MediaStreamTrack;
  private viewers = new Map<string, Viewer>();
  private seq = 0;
  private live = false;
  /** Bytes handed to the channels, for the e2e test and debugging. */
  sent = 0;

  constructor(track: MediaStreamTrack) {
    this.clone = track.clone();
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
      const v: Viewer = { ch, needKey: true };
      this.viewers.set(id, v);
      // Caught up again after a backlog: start over from a key frame.
      ch.bufferedAmountLowThreshold = BACKLOG / 4;
      ch.addEventListener('bufferedamountlow', () => v.needKey && this.post({ t: 'key' }));
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
    for (const v of this.viewers.values()) {
      if (v.ch.readyState !== 'open') continue;
      if (v.needKey && !m.key) continue;
      if (v.ch.bufferedAmount > BACKLOG) {
        v.needKey = true; // the bufferedamountlow handler asks for a key frame once it drains
        continue;
      }
      v.needKey = false;
      try {
        for (const p of pieces) v.ch.send(p);
        this.sent += m.data.byteLength;
      } catch {
        v.needKey = true;
      }
    }
  }

  stop() {
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

  constructor(private askKey: () => void) {
    this.canvas.width = 1920;
    this.canvas.height = 1080;
    this.stream = this.canvas.captureStream(0);
    this.track = this.stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;
  }

  receive(buf: ArrayBuffer) {
    if (this.closed) return;
    const dv = new DataView(buf);
    const key = (dv.getUint8(0) & 1) === 1, part = dv.getUint8(1), parts = dv.getUint8(2), seq = dv.getUint32(4);
    if (part === 0) {
      // The sharer skips frames for a viewer that's behind, and restarts on a key frame.
      if (seq !== this.lastSeq + 1 && !key) this.lost();
      this.lastSeq = seq;
      this.parts = [];
    } else if (seq !== this.lastSeq || part !== this.parts.length) return this.lost();
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
          this.lost();
        },
      });
      // Without optimizeForLatency the decoder holds a few frames back.
      this.decoder.configure({ codec: CAST_CODEC, codedWidth: w, codedHeight: h, optimizeForLatency: true });
    }
    if (!this.decoder || this.decoder.state !== 'configured') return;
    this.waitKey = false;
    try {
      this.decoder.decode(new EncodedVideoChunk({ type: key ? 'key' : 'delta', timestamp: ts, data }));
    } catch {
      this.lost();
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
    this.track.requestFrame();
  }

  /** Out of step: drop everything until the next key frame, and ask for one. */
  private lost() {
    this.waitKey = true;
    this.parts = [];
    this.ask();
  }

  private ask() {
    const t = performance.now();
    if (t - this.asked < 1000) return;
    this.asked = t;
    this.askKey();
  }

  close() {
    this.closed = true;
    if (this.decoder?.state === 'configured') this.decoder.close();
    this.track.stop();
  }
}
