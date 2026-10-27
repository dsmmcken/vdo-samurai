// Renders the final cut: 1920x1080, 30 fps, H.264 MP4, written straight into OPFS.
//
// Picture: follows the director's stage log, drawn from everyone's full-quality
// recordings. A screen on stage gets the presenter's camera as a rounded box in the
// bottom-right corner; the end screen is a grid of every camera.
// Sound: the director plus whoever is on stage (everyone on the end screen).
import {
  ALL_FORMATS,
  AudioSampleSink,
  AudioSampleSource,
  AudioSample,
  BlobSource,
  CanvasSource,
  Input,
  Mp4OutputFormat,
  Output,
  StreamTarget,
  VideoSampleSink,
  canEncodeAudio,
  canEncodeVideo,
  type VideoSample,
} from 'mediabunny';
import type { DirectorManifest, PeerId, Profile, RecFile } from '../lib/types';
import { audible, gridFor, lowerThirds, segments, videoStart, type Segment } from './plan';

const W = 1920;
const H = 1080;
const FPS = 30;
const RATE = 48000;
const AUDIO_BLOCK = RATE / 2; // mix half a second at a time
const BG = '#0d0d12';
const LOWER_THIRD = '#0625c0';

// Presenter overlay while a screen is on stage: a portrait rounded rectangle,
// the same distance from the right and bottom edges.
const PIP = { w: 156, h: 195, margin: 32, radius: 22 };

const post = (m: unknown) => (self as unknown as Worker).postMessage(m);

self.onmessage = async (e: MessageEvent<{ manifest: DirectorManifest }>) => {
  try {
    await render(e.data.manifest);
  } catch (err) {
    console.error(err);
    post({ t: 'error', error: String((err as Error)?.message ?? err) });
  }
};

interface Source {
  file: RecFile;
  input: Input;
  start: number; // take seconds of the file's time zero
  end: number;
  video: VideoSampleSink | null;
  audio: Awaited<ReturnType<Input['getPrimaryAudioTrack']>>;
}

async function render(m: DirectorManifest) {
  if (!(await canEncodeVideo('avc', { width: W, height: H }))) throw new Error('This browser cannot encode H.264 video.');
  const dir = await openTakeDir(m.take.id);
  const duration = ((m.take.stopAt ?? m.take.startAt) - m.take.startAt) / 1000;
  const segs = segments(m);

  // Open every recorded file.
  const sources: Source[] = [];
  for (const f of Object.values(m.files)) {
    if (!f.done || !f.size) continue;
    const blob = await (await dir.getFileHandle(f.name)).getFile();
    const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
    const vt = await input.getPrimaryVideoTrack();
    const at = f.kind === 'cam' ? await input.getPrimaryAudioTrack() : null;
    // File timestamps count from the file's time zero, which sits at f.offset on the take timeline.
    const len = await input.computeDuration();
    // Safety net: a camera file whose audio stops well before its video means
    // the recorder lost the mic; say so instead of rendering silence quietly.
    if (at && vt) {
      const [aEnd, vEnd] = await Promise.all([at.computeDuration(), vt.computeDuration()]);
      if (aEnd < vEnd - 1.5) post({ t: 'warn', message: `${m.profiles[f.peer]?.name ?? f.peer}: audio stops ${Math.round(vEnd - aEnd)} s before the video` });
    }
    const start = f.offset / 1000;
    sources.push({ file: f, input, start, end: start + len, video: vt ? new VideoSampleSink(vt) : null, audio: at });
  }
  const camPeers = orderedCamPeers(m, sources);
  // The output's time zero is take time t0.
  const t0 = videoStart(sources.filter((x) => x.video).map((x) => x.start));
  const thirds = lowerThirds(segs, t0);

  // Output.
  const fh = await dir.getFileHandle('final.mp4', { create: true });
  const writable = await fh.createWritable();
  const output = new Output({ format: new Mp4OutputFormat(), target: new StreamTarget(writable as any) });
  const canvas = new OffscreenCanvas(W, H);
  const ctx = canvas.getContext('2d')!;
  const video = new CanvasSource(canvas, { codec: 'avc', bitrate: 8_000_000, keyFrameInterval: 2 });
  output.addVideoTrack(video, { frameRate: FPS });
  const audioSources = sources.filter((s) => s.audio);
  const audioCodec = (await canEncodeAudio('aac', { numberOfChannels: 2, sampleRate: RATE })) ? 'aac' : 'opus';
  const audio = audioSources.length ? new AudioSampleSource({ codec: audioCodec, bitrate: 160_000 }) : null;
  if (audio) output.addAudioTrack(audio);
  await output.start();

  const cursors = new Map<string, VideoCursor>();
  const cursor = (s: Source) => {
    let c = cursors.get(s.file.name);
    if (!c) cursors.set(s.file.name, (c = new VideoCursor(s.video!)));
    return c;
  };
  // A file that starts a moment late holds its first frame rather than leaving a gap.
  const sourceAt = (peer: PeerId, kind: 'cam' | 'screen', t: number) =>
    sources.find((s) => s.video && s.file.peer === peer && s.file.kind === kind && t >= s.start - 1 && t < s.end) ?? null;
  const frameAt = async (peer: PeerId, kind: 'cam' | 'screen', t: number) => {
    const s = sourceAt(peer, kind, t);
    return s ? cursor(s).at(Math.max(0, t - s.start)) : null;
  };

  const mixer = new Mixer(audioSources, segs, m.take.director);
  const total = Math.max(1, Math.round((duration - t0) * FPS));
  const wallStart = performance.now();
  let audioUntil = t0; // take time
  let segIdx = 0;
  let lastPost = 0;

  for (let k = 0; k < total; k++) {
    const t = t0 + k / FPS; // take time; the output timestamp is k / FPS
    while (segIdx < segs.length - 1 && t >= segs[segIdx].end) {
      segIdx++;
      releaseUnused(cursors, sources, segs[segIdx], t);
    }
    const seg = segs[segIdx];

    // Keep audio about a second ahead of video so the muxer can interleave.
    while (audio && audioUntil < Math.min(duration, t + 1)) {
      const n = Math.min(AUDIO_BLOCK, Math.round((duration - audioUntil) * RATE));
      if (n <= 0) break;
      const planes = await mixer.mix(audioUntil, n);
      const data = new Float32Array(n * 2);
      data.set(planes[0], 0);
      data.set(planes[1], n);
      const sample = new AudioSample({ data, format: 'f32-planar', numberOfChannels: 2, sampleRate: RATE, timestamp: audioUntil - t0 });
      await audio.add(sample);
      sample.close();
      audioUntil += n / RATE;
    }

    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, W, H);
    const st = seg.stage;
    if (st.kind === 'end') {
      const cells = gridFor(Math.max(1, camPeers.length), W, H, 32);
      for (let i = 0; i < camPeers.length; i++) {
        const c = cells[i];
        const f = await frameAt(camPeers[i], 'cam', t);
        ctx.save();
        ctx.clip(roundRect(c.x, c.y, c.w, c.h, 24));
        if (f) drawCover(ctx, f, c.x, c.y, c.w, c.h);
        else placeholder(ctx, c.x, c.y, c.w, c.h, m.profiles[camPeers[i]]);
        ctx.restore();
      }
    } else {
      const screen = st.view === 'screen' ? await frameAt(st.id, 'screen', t) : null;
      const cam = await frameAt(st.id, 'cam', t);
      if (screen) {
        drawContain(ctx, screen, 0, 0, W, H);
        const x = W - PIP.w - PIP.margin;
        const y = H - PIP.h - PIP.margin;
        const path = roundRect(x, y, PIP.w, PIP.h, PIP.radius);
        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,0.45)';
        ctx.shadowBlur = 30;
        ctx.fillStyle = BG;
        ctx.fill(path);
        ctx.restore();
        ctx.save();
        ctx.clip(path);
        if (cam) drawCover(ctx, cam, x, y, PIP.w, PIP.h);
        else placeholder(ctx, x, y, PIP.w, PIP.h, m.profiles[st.id]);
        ctx.restore();
        ctx.lineWidth = 2;
        ctx.strokeStyle = 'rgba(255,255,255,0.7)';
        ctx.stroke(path);
      } else if (cam) {
        drawCover(ctx, cam, 0, 0, W, H);
      } else {
        placeholder(ctx, 0, 0, W, H, m.profiles[st.id]);
      }
      const lt = thirds.get(st.id);
      if (lt && t >= lt.start && t < lt.end) lowerThird(ctx, m.profiles[st.id], t - lt.start, lt.end - lt.start);
    }

    await video.add(k / FPS, 1 / FPS);

    const wall = (performance.now() - wallStart) / 1000;
    if (wall - lastPost > 0.5) {
      lastPost = wall;
      post({ t: 'progress', progress: k / total, speed: k / FPS / wall });
    }
  }

  for (const c of cursors.values()) await c.close();
  await mixer.close();
  await output.finalize();
  post({ t: 'done', seconds: duration - t0, audioCodec });
}

async function openTakeDir(takeId: string) {
  const root = await navigator.storage.getDirectory();
  return (await root.getDirectoryHandle('takes')).getDirectoryHandle(takeId);
}

/** End-screen order: tile order at take start, then anyone else who recorded a camera. */
function orderedCamPeers(m: DirectorManifest, sources: Source[]) {
  const withCam = new Set(sources.filter((s) => s.file.kind === 'cam' && s.video).map((s) => s.file.peer));
  return [...m.order.filter((p) => withCam.has(p)), ...[...withCam].filter((p) => !m.order.includes(p)).sort()];
}

/** Close decoders that the new segment won't use, so we never hold more open than needed. */
function releaseUnused(cursors: Map<string, VideoCursor>, sources: Source[], seg: Segment, t: number) {
  const keep = new Set<string>();
  for (const s of sources) {
    if (t < s.start || t >= s.end) continue;
    if (seg.stage.kind === 'end' ? s.file.kind === 'cam' : s.file.peer === seg.stage.id) keep.add(s.file.name);
  }
  for (const [name, c] of cursors) {
    if (!keep.has(name)) {
      c.close();
      cursors.delete(name);
    }
  }
}

/** Sequential frame access: decodes forward, re-seeks only on jumps. */
class VideoCursor {
  private it: AsyncGenerator<VideoSample, void, unknown> | null = null;
  private cur: VideoSample | null = null;
  private next: VideoSample | null = null;
  constructor(private sink: VideoSampleSink) {}

  async at(ts: number): Promise<VideoSample | null> {
    const stale = !this.it || (this.cur && ts < this.cur.timestamp - 0.05) || (this.next && ts > this.next.timestamp + 2);
    if (stale) {
      await this.close();
      this.it = this.sink.samples(ts);
      this.cur = (await this.it.next()).value ?? null;
      this.next = (await this.it.next()).value ?? null;
    }
    while (this.next && this.next.timestamp <= ts + 1e-6) {
      this.cur?.close();
      this.cur = this.next;
      this.next = (await this.it!.next()).value ?? null;
    }
    return this.cur;
  }

  async close() {
    this.cur?.close();
    this.next?.close();
    this.cur = this.next = null;
    await this.it?.return();
    this.it = null;
  }
}

/** Mixes everyone's microphone with per-person gains that follow the stage, with short ramps. */
class Mixer {
  private tracks: {
    peer: PeerId;
    pos: number; // take sample index of buf[0][0]
    zero: number; // take sample index of the file's audio time zero
    it: AsyncGenerator<AudioSample, void, unknown>;
    buf: [Float32Array, Float32Array];
    gain: number;
    done: boolean;
  }[];
  constructor(
    sources: Source[],
    private segs: Segment[],
    private director: PeerId,
  ) {
    this.tracks = sources.map((s) => ({
      peer: s.file.peer,
      pos: Math.round(((s.file.audioOffset ?? s.file.offset) / 1000) * RATE),
      zero: Math.round(((s.file.audioOffset ?? s.file.offset) / 1000) * RATE),
      it: new AudioSampleSink(s.audio!).samples(),
      buf: [new Float32Array(0), new Float32Array(0)],
      gain: 0,
      done: false,
    }));
  }

  private stageAt(t: number) {
    return (this.segs.find((s) => t >= s.start && t < s.end) ?? this.segs[this.segs.length - 1]).stage;
  }

  async mix(t: number, n: number): Promise<[Float32Array, Float32Array]> {
    const from = Math.round(t * RATE);
    const out: [Float32Array, Float32Array] = [new Float32Array(n), new Float32Array(n)];
    const step = 1 / (0.03 * RATE); // 30 ms fades
    for (const tr of this.tracks) {
      // Files usually start before zero (recorders start during the countdown)
      // and the edit may start later still: drop audio from before this block.
      if (tr.pos < from) {
        await this.fill(tr, from - tr.pos);
        const drop = Math.min(from - tr.pos, tr.buf[0].length);
        tr.buf = [tr.buf[0].subarray(drop), tr.buf[1].subarray(drop)];
        tr.pos += drop;
        if (tr.pos < from) continue; // file ended before this block
      }
      // Silence before this file starts, then its samples in order.
      const lead = Math.min(n, Math.max(0, tr.pos - from));
      const need = n - lead;
      await this.fill(tr, need);
      const L = tr.buf[0];
      const R = tr.buf[1];
      let target = 0;
      for (let i = 0; i < need; i++) {
        const j = lead + i;
        if (i === 0 || j % 480 === 0) target = audible(this.stageAt((from + j) / RATE), tr.peer, this.director) ? 1 : 0;
        tr.gain += Math.max(-step, Math.min(step, target - tr.gain));
        if (tr.gain === 0) continue;
        out[0][j] += (L[i] ?? 0) * tr.gain;
        out[1][j] += (R[i] ?? 0) * tr.gain;
      }
      tr.buf = [L.subarray(Math.min(need, L.length)), R.subarray(Math.min(need, R.length))];
      tr.pos = from + n;
    }
    for (const ch of out) for (let i = 0; i < n; i++) ch[i] = Math.max(-1, Math.min(1, ch[i]));
    return out;
  }

  /**
   * Appends decoded audio until `need` samples are buffered, placing each chunk
   * at its own timestamp: a gap (dropped audio) becomes silence and an overlap
   * is trimmed. Jitter under 10 ms is ignored. This also absorbs slow drift
   * between the mic's sample clock and the capture clock over a long take.
   */
  private async fill(tr: Mixer['tracks'][number], need: number) {
    while (!tr.done && tr.buf[0].length < need) {
      const { value, done } = await tr.it.next();
      if (done || !value) {
        tr.done = true;
        break;
      }
      let planes = toStereo48k(value);
      const at = tr.zero + Math.round(value.timestamp * RATE); // take sample index of this chunk
      value.close();
      const end = tr.pos + tr.buf[0].length;
      if (at > end + 480 && at - end < RATE * 60) {
        const gap = new Float32Array(at - end);
        tr.buf = [concat(tr.buf[0], gap), concat(tr.buf[1], gap)];
      } else if (at < end - 480) {
        const cut = Math.min(end - at, planes[0].length);
        planes = [planes[0].subarray(cut), planes[1].subarray(cut)];
      }
      tr.buf = [concat(tr.buf[0], planes[0]), concat(tr.buf[1], planes[1])];
    }
  }

  async close() {
    for (const tr of this.tracks) await tr.it.return();
  }
}

function toStereo48k(s: AudioSample): [Float32Array, Float32Array] {
  const frames = s.numberOfFrames;
  const planes: Float32Array[] = [];
  for (let c = 0; c < Math.min(2, s.numberOfChannels); c++) {
    const a = new Float32Array(frames);
    s.copyTo(a, { planeIndex: c, format: 'f32-planar' });
    planes.push(a);
  }
  if (planes.length === 1) planes.push(planes[0]);
  if (s.sampleRate === RATE) return [planes[0], planes[1]];
  return [resample(planes[0], s.sampleRate), resample(planes[1], s.sampleRate)];
}

function resample(a: Float32Array, rate: number) {
  const n = Math.round((a.length * RATE) / rate);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i * rate) / RATE;
    const j = Math.floor(x);
    const f = x - j;
    out[i] = (a[j] ?? 0) * (1 - f) + (a[j + 1] ?? a[j] ?? 0) * f;
  }
  return out;
}

function concat(a: Float32Array, b: Float32Array) {
  if (!a.length) return b;
  const out = new Float32Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

// ------------------------------------------------------------------ drawing

type Ctx = OffscreenCanvasRenderingContext2D;

function drawCover(ctx: Ctx, f: VideoSample, x: number, y: number, w: number, h: number) {
  const sw = f.displayWidth;
  const sh = f.displayHeight;
  const scale = Math.max(w / sw, h / sh);
  const cw = w / scale;
  const ch = h / scale;
  f.draw(ctx, (sw - cw) / 2, (sh - ch) / 2, cw, ch, x, y, w, h);
}

function drawContain(ctx: Ctx, f: VideoSample, x: number, y: number, w: number, h: number) {
  const scale = Math.min(w / f.displayWidth, h / f.displayHeight);
  const dw = f.displayWidth * scale;
  const dh = f.displayHeight * scale;
  f.draw(ctx, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

function roundRect(x: number, y: number, w: number, h: number, r: number) {
  const p = new Path2D();
  p.roundRect(x, y, w, h, r);
  return p;
}

function placeholder(ctx: Ctx, x: number, y: number, w: number, h: number, p?: Profile) {
  ctx.fillStyle = '#1d1d26';
  ctx.fillRect(x, y, w, h);
  const initials = (p?.name || '?')
    .split(/\s+/)
    .map((s) => s[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  ctx.fillStyle = '#8b8b9a';
  ctx.font = `600 ${Math.round(Math.min(w, h) / 4)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(initials, x + w / 2, y + h / 2);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

/** Bottom-left name and subtitle; slides in, holds, fades out. */
function lowerThird(ctx: Ctx, p: Profile | undefined, t: number, len: number) {
  if (!p?.name) return;
  const IN = 0.45;
  const OUT = 0.45;
  const k = Math.min(1, t / IN, Math.max(0, (len - t) / OUT));
  const ease = 1 - (1 - k) ** 3;
  const x = 64 - (1 - ease) * 80;
  const yBase = H - 80;
  ctx.save();
  ctx.globalAlpha = ease;
  ctx.font = '700 46px system-ui, sans-serif';
  const nameW = ctx.measureText(p.name).width;
  ctx.font = '500 28px system-ui, sans-serif';
  const subW = p.subtitle ? ctx.measureText(p.subtitle).width : 0;
  const w = Math.max(nameW, subW) + 64;
  const h = p.subtitle ? 124 : 84;
  const y = yBase - h;
  ctx.fillStyle = 'rgba(12,12,18,0.82)';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = LOWER_THIRD;
  ctx.fillRect(x, y, 8, h);
  ctx.fillStyle = '#fff';
  ctx.font = '700 46px system-ui, sans-serif';
  ctx.fillText(p.name, x + 36, y + 62);
  if (p.subtitle) {
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.font = '500 28px system-ui, sans-serif';
    ctx.fillText(p.subtitle, x + 36, y + 104);
  }
  ctx.restore();
}
