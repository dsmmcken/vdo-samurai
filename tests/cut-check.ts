// Browser side of cut-check.mjs: makes a recording like ours, cuts it with
// src/lib/cut.ts, and reads the result back the way the render does.
import { AudioSample, AudioSampleSink, AudioSampleSource, ALL_FORMATS, BlobSource, BufferTarget, CanvasSource, EncodedPacketSink, Input, Mp4OutputFormat, Output, VideoSampleSink } from 'mediabunny';
import { cutRecording, verifyCut, type Span } from '../src/lib/cut';

const FPS = 30;
const SECONDS = 20;

/** Each frame's colour says when it is: red = frame within the second, green = the second. */
const colourAt = (t: number) => [Math.round((t % 1) * FPS) * 8, Math.floor(t) * 12];

async function makeRecording(withAudio = true) {
  const canvas = new OffscreenCanvas(320, 180);
  const g = canvas.getContext('2d')!;
  const out = new Output({ format: new Mp4OutputFormat({ fastStart: 'fragmented' }), target: new BufferTarget() });
  const video = new CanvasSource(canvas, { codec: 'avc', bitrate: 2e6, keyFrameInterval: 2 });
  const audio = withAudio ? new AudioSampleSource({ codec: 'opus', bitrate: 64_000 }) : null;
  out.addVideoTrack(video, { frameRate: FPS });
  if (audio) out.addAudioTrack(audio);
  await out.start();
  for (let k = 0; k < SECONDS * FPS; k++) {
    const t = k / FPS;
    if (audio && k % FPS === 0) {
      const tone = new Float32Array(48000).map((_, i) => 0.2 * Math.sin((2 * Math.PI * 440 * i) / 48000));
      const s = new AudioSample({ data: tone, format: 'f32', numberOfChannels: 1, sampleRate: 48000, timestamp: t });
      await audio.add(s);
      s.close();
    }
    const [r, gr] = colourAt(t);
    g.fillStyle = `rgb(${r},${gr},0)`;
    g.fillRect(0, 0, 320, 180);
    await video.add(t, 1 / FPS);
  }
  await out.finalize();
  return new Blob([out.target.buffer!]);
}

/** A WritableStream like OPFS's: positioned writes, collected in memory. */
function memoryWritable() {
  const parts: { at: number; data: Uint8Array }[] = [];
  const stream = new WritableStream<{ type: string; data: Uint8Array; position: number }>({
    write(c) {
      parts.push({ at: c.position, data: c.data.slice() });
    },
  });
  const blob = () => {
    const size = Math.max(...parts.map((p) => p.at + p.data.length));
    const buf = new Uint8Array(size);
    for (const p of parts) buf.set(p.data, p.at);
    return new Blob([buf]);
  };
  return { stream, blob };
}

async function pixel(sink: VideoSampleSink, t: number) {
  const s = await sink.getSample(t);
  if (!s) return { t, got: null };
  const c = new OffscreenCanvas(8, 8);
  const g = c.getContext('2d')!;
  s.draw(g, 0, 0, 8, 8);
  const [r, gr] = g.getImageData(4, 4, 1, 1).data;
  const out = { t, got: +s.timestamp.toFixed(3), rgb: [r, gr], want: colourAt(s.timestamp) };
  s.close();
  return out;
}

export async function run() {
  return { withAudio: await check(true), videoOnly: await check(false) };
}

async function check(withAudio: boolean) {
  const original = await makeRecording(withAudio);
  const keep: Span[] = [
    [3, 5],
    [12.3, 14],
  ];
  const mem = memoryWritable();
  const result = await cutRecording(original, keep, mem.stream);
  const cut = mem.blob();
  const verify = await verifyCut(cut, result.stamps);
  const keys = result.stamps.filter(([, k]) => k).map(([t]) => +t.toFixed(3));

  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(cut) });
  const vt = (await input.getPrimaryVideoTrack())!;
  const at = await input.getPrimaryAudioTrack();
  // Which video timestamps survived, as runs.
  const runs: [number, number][] = [];
  for await (const p of new EncodedPacketSink(vt).packets()) {
    const last = runs[runs.length - 1];
    if (last && p.timestamp - last[1] < 1.5 / FPS) last[1] = p.timestamp;
    else runs.push([p.timestamp, p.timestamp]);
  }
  const sink = new VideoSampleSink(vt);
  const frames = [];
  for (const t of [3.0, 4.5, 4.97, 12.5, 13.9, 8.0, 0.5, 19.0]) frames.push(await pixel(sink, t));
  // The render reads sequentially from a seek: samples(ts) from a keyframe forward.
  const seq: number[] = [];
  for await (const s of sink.samples(12.3, 12.5)) {
    seq.push(+s.timestamp.toFixed(3));
    s.close();
  }
  let audioSeconds = 0;
  let audioFirst: number | null = null;
  let audioLast = 0;
  if (at)
  for await (const s of new AudioSampleSink(at).samples()) {
    audioFirst ??= s.timestamp;
    audioLast = s.timestamp + s.duration;
    audioSeconds += s.duration;
    s.close();
  }
  return {
    verify: verify ?? 'ok',
    keys,
    sizes: { original: original.size, cut: cut.size },
    result,
    runs: runs.map(([a, b]) => [+a.toFixed(3), +b.toFixed(3)]),
    durations: { input: await input.computeDuration(), video: await vt.computeDuration(), audio: await at?.computeDuration() },
    frames,
    seq,
    audio: { seconds: +audioSeconds.toFixed(3), first: audioFirst, last: +audioLast.toFixed(3) },
  };
}
