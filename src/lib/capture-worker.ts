// Records one camera (video + mic) or one screen to an MP4 in OPFS, using
// WebCodecs. Audio and video are written with timestamps we compute ourselves
// (see "Timing" below), so lip sync and the file's start time don't depend on
// the browser's absolute timestamps, which aren't reliable across platforms.
import { ALL_FORMATS, AudioSample, AudioSampleSource, BlobSource, Input, Mp4OutputFormat, Output, StreamTarget, VideoSample, VideoSampleSource } from 'mediabunny';

type Start = {
  t: 'start';
  takeId: string;
  name: string;
  video: ReadableStream<VideoFrame> | null;
  audio: ReadableStream<AudioData> | null;
  videoBitrate: number;
  screen: boolean;
  /** Test hook: make the audio encoder fail after this many chunks. */
  failAudioAfter?: number;
};

const post = (m: unknown) => (self as unknown as Worker).postMessage(m);
// Report each distinct problem once; keep recording whatever still works.
const warned = new Set<string>();
const warn = (msg: string) => {
  const key = msg.slice(0, 80);
  if (warned.has(key)) return;
  warned.add(key);
  post({ t: 'warn', message: msg });
};
let stopRequested: (() => void) | null = null;

// Mid-recording track swaps (camera back on, or a different camera / mic).
let swapVideo: ((s: ReadableStream<VideoFrame> | null) => void) | null = null;
let swapAudio: ((s: ReadableStream<AudioData> | null) => void) | null = null;

type Swap = { t: 'video'; stream: ReadableStream<VideoFrame> | null } | { t: 'audio'; stream: ReadableStream<AudioData> | null };
self.onmessage = (e: MessageEvent<Start | Swap | { t: 'stop' }>) => {
  if (e.data.t === 'stop') stopRequested?.();
  else if (e.data.t === 'video') swapVideo?.(e.data.stream);
  else if (e.data.t === 'audio') swapAudio?.(e.data.stream);
  else record(e.data).catch((err) => post({ t: 'error', error: `${err?.name ?? 'Error'}: ${err?.message ?? err}`, stack: String(err?.stack ?? '') }));
};

async function record(job: Start) {
  const root = await navigator.storage.getDirectory();
  const dir = await (await root.getDirectoryHandle('takes', { create: true })).getDirectoryHandle(job.takeId, { create: true });
  const fileHandle = await dir.getFileHandle(job.name, { create: true });
  const handle = await (fileHandle as any).createSyncAccessHandle();
  handle.truncate(0);
  let size = 0;
  const writable = new WritableStream<{ type: 'write'; data: Uint8Array; position: number }>({
    write(chunk) {
      handle.write(chunk.data, { at: chunk.position });
      size = Math.max(size, chunk.position + chunk.data.byteLength);
    },
  });

  // Fragmented MP4: appended as it goes, so a crash still leaves a playable file.
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'fragmented' }), target: new StreamTarget(writable) });
  // A camera recording always has a video track, even if the camera starts off.
  const hasVideo = !!job.video || !job.screen;
  const video = hasVideo
    ? new VideoSampleSource({
        codec: 'avc',
        bitrate: job.videoBitrate,
        keyFrameInterval: 2,
        latencyMode: 'realtime',
        // Shared windows can change size mid-take; keep one output size.
        sizeChangeBehavior: 'contain',
      } as any)
    : null;
  // Always Opus for the recordings: Chrome ships its own Opus encoder, so it
  // behaves the same everywhere, while AAC goes through each OS's encoder (Media
  // Foundation on Windows). Only our compositor reads these files; the final
  // cut still uses AAC where available.
  const audioCodec = 'opus' as const;
  const audio = job.audio ? new AudioSampleSource({ codec: audioCodec, bitrate: 128_000 }) : null;
  if (video) output.addVideoTrack(video, { frameRate: 30 });
  if (audio) output.addAudioTrack(audio);
  await output.start();
  // Counters for the recording report.
  const stats = { framesIn: 0, framesOut: 0, framesRepeated: 0, audioIn: 0, audioOut: 0, audioGaps: 0, audioDriftMs: 0 };
  post({ t: 'info', message: `encoders: video ${video ? `avc ${job.videoBitrate / 1e6} Mbps` : 'none'}, audio ${audio ? `${audioCodec} 128 kbps` : 'none'}` });

  // Timing, kept deliberately simple: we never trust absolute timestamps from
  // the browser (on Windows the first mic chunks came 6 s off). Instead:
  //  - media time: video frames keep their spacing relative to the first frame;
  //    audio time is just the number of samples so far.
  //  - wall time of media time 0: the smallest (arrival - media time) seen,
  //    i.e. the earliest arrival net of any delay. Late or bursty deliveries
  //    can only make that number bigger, so the minimum ignores them.
  // Audio waits one second before writing so its start is settled, and is then
  // written back to back; it only jumps forward when every chunk for a whole
  // second arrives late, which means audio was really dropped.
  const wallNow = () => performance.timeOrigin + performance.now();
  let videoZero: number | null = null; // wall ms of video media time 0 (refined as frames arrive)
  let stopping = false;
  let fatal: string | null = null;
  const stopped = new Promise<void>((r) => (stopRequested = () => ((stopping = true), r())));
  /** Reads a stream until it ends, it's replaced (`cancel`), or we stop. */
  const read = <T extends VideoFrame | AudioData>(stream: ReadableStream<T>, onChunk: (chunk: T) => Promise<void>) => {
    const reader = stream.getReader();
    let cancelled = false;
    const cancel = () => {
      cancelled = true;
      reader.cancel().catch(() => {});
    };
    stopped.then(cancel);
    const done = (async () => {
      while (!stopping && !cancelled) {
        const { value, done } = await reader.read().catch(() => ({ value: undefined, done: true }));
        if (done || !value) break;
        try {
          await onChunk(value);
        } finally {
          value.close();
        }
      }
    })();
    return { done, cancel };
  };

  const pumps: Promise<void>[] = [];
  // Screen capture only delivers a frame when something changes, so a still
  // screen can produce two frames in a whole take. Hold the last frame and
  // re-write it every half second while nothing new arrives (and once more at
  // the end), so the file covers the whole time the screen was shared.
  let finishVideo: (() => Promise<void>) | null = null;
  if (hasVideo && video) {
    let last = -1;
    let held: VideoFrame | null = null;
    let heldAt = 0;
    let chain = Promise.resolve();
    const add = (frame: VideoFrame, ts: number) =>
      (chain = chain.then(async () => {
        if (fatal || ts <= last) return frame.close();
        last = ts;
        const s = new VideoSample(frame, { timestamp: ts });
        try {
          await video.add(s);
          stats.framesOut++;
        } catch (e) {
          fatal ??= `video encoder: ${e}`;
          stopRequested?.();
        } finally {
          s.close();
        }
      }));
    const repeatHeld = () => {
      if (!held || videoZero === null) return;
      stats.framesRepeated++;
      heldAt = wallNow();
      return add(held.clone(), (heldAt - videoZero) / 1000);
    };
    const timer = setInterval(() => {
      if (!stopping && held && wallNow() - heldAt > 500) repeatHeld();
    }, 250);
    finishVideo = async () => {
      clearInterval(timer);
      await repeatHeld(); // carry the picture right up to the stop
      await chain;
      held?.close();
      held = null;
    };

    // Camera off when the take starts: begin with one black 1080p frame so
    // the file has video from zero (the final cut shows initials there anyway).
    if (!job.video) {
      const c = new OffscreenCanvas(1920, 1080);
      const g = c.getContext('2d')!;
      g.fillStyle = '#000';
      g.fillRect(0, 0, 1920, 1080);
      videoZero = wallNow();
      held = new VideoFrame(c, { timestamp: 0 });
      heldAt = videoZero;
      add(held.clone(), 0);
      post({ t: 'started' });
    }

    let current: ReturnType<typeof read> | null = null;
    // Segment 0 is the camera the take started with: it defines the file's zero
    // from frame spacing. Any later segment (camera back on, another camera, or
    // the first one after a black start) is placed by its first frame's arrival.
    let segments = job.video ? 0 : 1;
    const start = (stream: ReadableStream<VideoFrame> | null) => {
      current?.cancel();
      current = null;
      if (!stream) return; // camera off: held frames carry on
      const seg = segments++;
      let segFirstUs: number | null = null;
      let segBase: number | null = null;
      const r = read(stream, async (frame) => {
        if (stats.framesIn++ === 0) {
          post({ t: 'info', message: `video in: ${frame.displayWidth}x${frame.displayHeight} ${frame.format ?? '?'}` });
          if (videoZero === null) post({ t: 'started' });
        }
        segFirstUs ??= frame.timestamp;
        let ts: number;
        if (seg === 0) {
          ts = (frame.timestamp - segFirstUs) / 1e6;
          const z = wallNow() - ts * 1000;
          if (videoZero === null || z < videoZero) videoZero = z;
        } else {
          segBase ??= (wallNow() - videoZero!) / 1000;
          ts = segBase + (frame.timestamp - segFirstUs) / 1e6;
        }
        if (ts < 0) return;
        held?.close();
        held = frame.clone();
        heldAt = wallNow();
        await add(frame.clone(), ts);
      });
      current = r;
      pumps.push(r.done);
    };
    swapVideo = (stream) => {
      post({ t: 'info', message: stream ? 'camera resumed' : 'camera off (holding last frame)' });
      start(stream);
    };
    start(job.video);
  }

  let audioZero: number | null = null; // wall ms of audio sample 0
  let flushAudio: (() => Promise<void>) | null = null;
  if (!job.screen && audio) {
    let written = 0; // samples placed so far, including forward jumps for dropped audio
    let fileOffset = 0; // file seconds of audio sample 0 (relative to the file's zero)
    let settled = false;
    const pending: { planar: Float32Array; ch: number; n: number; rate: number }[] = [];
    let windowMinLate = Infinity;
    let windowCount = 0;

    const write = async (planar: Float32Array, ch: number, n: number, rate: number) => {
      if (fatal) return;
      let ts = fileOffset + written / rate;
      written += n;
      let skip = 0;
      if (ts < 0) {
        skip = Math.min(n, Math.ceil(-ts * rate));
        ts = 0;
      }
      if (skip >= n) return;
      const keep = n - skip;
      const data = skip ? new Float32Array(ch * keep) : planar;
      if (skip) for (let c = 0; c < ch; c++) data.set(planar.subarray(c * n + skip, (c + 1) * n), c * keep);
      const sample = new AudioSample({ data, format: 'f32-planar', numberOfChannels: ch, sampleRate: rate, timestamp: ts });
      try {
        if (job.failAudioAfter !== undefined && stats.audioOut >= job.failAudioAfter) throw new Error('simulated failure (test hook)');
        await audio.add(sample);
        stats.audioOut++;
      } catch (e) {
        // Losing audio silently is the worst outcome: stop, so the room can
        // switch to the backup recorder right away.
        fatal ??= `audio encoder: ${e}`;
        stopRequested?.();
      } finally {
        sample.close();
      }
    };

    // Place audio relative to the file's zero (the video's, when there is video).
    const settle = async () => {
      if (settled || audioZero === null) return;
      settled = true;
      fileOffset = videoZero !== null ? (audioZero - videoZero) / 1000 : 0;
      post({ t: 'info', message: `audio starts ${Math.round(fileOffset * 1000)} ms after the video's first frame` });
      for (const p of pending.splice(0)) await write(p.planar, p.ch, p.n, p.rate);
    };
    flushAudio = settle;

    let resync = false; // set when a new mic stream takes over
    let current: ReturnType<typeof read> | null = null;
    const onAudio = async (data: AudioData) => {
        if (stats.audioIn++ === 0) {
          post({ t: 'info', message: `audio in: ${data.sampleRate} Hz, ${data.numberOfChannels} ch, ${data.format}, ${data.numberOfFrames} frames/chunk` });
          if (!hasVideo) post({ t: 'started' });
        }
        const ch = data.numberOfChannels;
        const n = data.numberOfFrames;
        const rate = data.sampleRate;
        // Copy out of the AudioData so our timestamp is the one that's encoded.
        const planar = new Float32Array(ch * n);
        for (let c = 0; c < ch; c++) data.copyTo(planar.subarray(c * n, (c + 1) * n), { planeIndex: c, format: 'f32-planar' });

        if (!settled) {
          // First second: find the start from the earliest arrival, then write.
          const samplesBefore = pending.reduce((acc, p) => acc + p.n, 0);
          const z = wallNow() - (samplesBefore / rate) * 1000;
          if (audioZero === null || z < audioZero) audioZero = z;
          pending.push({ planar, ch, n, rate });
          if (samplesBefore + n >= rate && (videoZero !== null || !hasVideo)) await settle();
          return;
        }
        if (resync) {
          // New mic: carry on from wherever the clock now says we are (forward only).
          resync = false;
          written = Math.max(written, Math.round(((wallNow() - audioZero!) / 1000) * rate) - n);
          windowMinLate = Infinity;
          windowCount = 0;
        }
        // How late is this chunk versus where the sample count says it belongs?
        const late = (wallNow() - (audioZero! + (written / rate) * 1000)) / 1000;
        windowMinLate = Math.min(windowMinLate, late);
        if (++windowCount >= rate / n) {
          // A whole second in which even the earliest chunk was late: audio was dropped.
          if (windowMinLate > 0.08) {
            written += Math.round(windowMinLate * rate);
            stats.audioGaps++;
          }
          stats.audioDriftMs = Math.round(windowMinLate * 1000);
          windowMinLate = Infinity;
          windowCount = 0;
        }
        await write(planar, ch, n, rate);
    };
    const start = (stream: ReadableStream<AudioData> | null) => {
      current?.cancel();
      current = null;
      if (!stream) return;
      current = read(stream, onAudio);
      pumps.push(current.done);
    };
    swapAudio = (stream) => {
      post({ t: 'info', message: stream ? 'microphone switched' : 'microphone stopped' });
      if (settled) resync = true;
      start(stream);
    };
    if (job.audio) start(job.audio);
  }

  await stopped;
  // Pumps can be added by swaps while we wait; settle until none are left.
  for (let n = 0; n !== pumps.length; ) {
    n = pumps.length;
    await Promise.allSettled(pumps);
  }
  await flushAudio?.(); // a take shorter than a second never settled its anchor
  await finishVideo?.();
  if (fatal) {
    // Keep what's on disk (fragmented MP4 stays readable) and report the failure.
    await output.cancel().catch(() => {});
    handle.flush();
    handle.close();
    throw new Error(fatal);
  }
  await output.finalize();
  handle.flush();
  handle.close();

  // Read the file back: how long is each track really?
  let videoEnd: number | null = null;
  let audioEnd: number | null = null;
  try {
    const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(await fileHandle.getFile()) });
    videoEnd = (await (await input.getPrimaryVideoTrack())?.computeDuration()) ?? null;
    audioEnd = (await (await input.getPrimaryAudioTrack())?.computeDuration()) ?? null;
  } catch (e) {
    warn(`could not read back the file: ${e}`);
  }
  // Wall time (local ms) of file time zero. The anchor used the first sample's
  // arrival time; the smallest gap seen since is closer to true capture time.
  post({ t: 'done', size, zeroWall: videoZero ?? audioZero, audioCodec, videoEnd, audioEnd, stats });
}
