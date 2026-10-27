// Full-quality local recording straight into OPFS.
//
// Preferred: WebCodecs capture in a worker (capture-worker.ts). Every frame and
// audio chunk keeps its capture timestamp, so lip sync inside the file is exact
// and we learn precisely when the file starts.
//
// Fallback (browsers without MediaStreamTrackProcessor): MediaRecorder, whose
// start time we can only estimate from events.
import { SequentialWriter } from './opfs';

export interface RecorderResult {
  size: number;
  /** Local wall-clock ms of file time zero, per track. */
  videoZero: number;
  audioZero: number;
  timing: 'capture' | 'estimated';
}

export interface Recorder {
  readonly takeId: string;
  readonly name: string;
  readonly kind: 'cam' | 'screen';
  readonly mime: string;
  /** Resolves with a first estimate of when recording started (local ms). */
  readonly started: Promise<number>;
  readonly recording: boolean;
  stop(): Promise<RecorderResult>;
}

/** What a recorder tells the room: plain info for the report, warnings, and fatal failures. */
export interface RecorderEvents {
  info?: (msg: string) => void;
  warn?: (msg: string) => void;
  /** The recorder died mid-take; the room should carry on with another one. */
  fail?: (msg: string) => void;
}

const BITRATE = { cam: 5_000_000, screen: 5_000_000 };

/** Test-only switches, set from the e2e test via localStorage. */
function testHook(name: string): number | undefined {
  try {
    const v = localStorage.getItem(`samurai:test:${name}`);
    return v === null ? undefined : Number(v);
  } catch {
    return undefined;
  }
}
const wall = () => performance.timeOrigin + performance.now();

/**
 * WebCodecs capture is used when the browser has it; if it ever fails mid-take,
 * this session switches to MediaRecorder.
 */
let captureHealthy: boolean | null = null;
export const captureStatus = () => captureHealthy;
export const markCaptureBroken = () => void (captureHealthy = false);
export const canCapture = () =>
  captureHealthy !== false &&
  typeof (globalThis as any).MediaStreamTrackProcessor !== 'undefined' &&
  typeof VideoEncoder !== 'undefined' &&
  typeof AudioEncoder !== 'undefined';

export function startRecorder(takeId: string, name: string, stream: MediaStream, kind: 'cam' | 'screen', events: RecorderEvents = {}): Recorder {
  return canCapture() ? new CaptureRecorder(takeId, name, stream, kind, events) : new FileRecorder(takeId, name, stream, kind);
}

export function fileExtension(kind: 'cam' | 'screen') {
  return canCapture() ? 'mp4' : extFor(pickMime(kind));
}

class CaptureRecorder implements Recorder {
  readonly mime = 'video/mp4';
  readonly started: Promise<number>;
  videoEnd: number | null = null;
  audioEnd: number | null = null;
  private worker = new Worker(new URL('./capture-worker.ts', import.meta.url), { type: 'module' });
  private done: Promise<RecorderResult>;
  private clones: MediaStreamTrack[] = [];
  private stopped = false;

  constructor(
    readonly takeId: string,
    readonly name: string,
    stream: MediaStream,
    readonly kind: 'cam' | 'screen',
    events: RecorderEvents,
  ) {
    // Clones, so stopping the recorder never touches the live meeting tracks.
    const v = stream.getVideoTracks()[0]?.clone() ?? null;
    const a = kind === 'cam' ? stream.getAudioTracks()[0]?.clone() ?? null : null;
    this.clones = [v, a].filter(Boolean) as MediaStreamTrack[];
    const Processor = (globalThis as any).MediaStreamTrackProcessor;
    const video = v ? new Processor({ track: v }).readable : null;
    const audio = a ? new Processor({ track: a, maxBufferSize: 50 }).readable : null;
    const calledAt = wall();
    let resolveStarted!: (t: number) => void;
    this.started = new Promise((r) => (resolveStarted = r));
    this.done = new Promise((resolve, reject) => {
      this.worker.onerror = (e) => {
        resolveStarted(calledAt);
        const msg = `worker crashed: ${e.message || 'unknown error'}`;
        events.fail?.(msg);
        reject(new Error(msg));
      };
      this.worker.onmessage = (e) => {
        const m = e.data;
        if (m.t === 'started') resolveStarted(calledAt);
        if (m.t === 'info') events.info?.(m.message);
        if (m.t === 'warn') {
          console.warn('[recorder]', name, m.message);
          events.warn?.(m.message);
        }
        if (m.t === 'error') {
          console.error('[recorder]', name, m.error, m.stack);
          resolveStarted(calledAt);
          if (!this.stopped) events.fail?.(m.error);
          reject(new Error(m.error));
        }
        if (m.t === 'done') {
          const zero = m.zeroWall ?? calledAt;
          this.videoEnd = m.videoEnd;
          this.audioEnd = m.audioEnd;
          const st = m.stats;
          events.info?.(
            `done: ${(m.size / 1e6).toFixed(1)} MB, video ${m.videoEnd?.toFixed(1) ?? '–'} s (${st.framesOut}/${st.framesIn} frames), ` +
              `audio ${m.audioEnd?.toFixed(1) ?? '–'} s (${st.audioOut}/${st.audioIn} chunks, ${st.audioGaps} gaps, audio lateness at the end ${st.audioDriftMs} ms)`,
          );
          if (a && m.videoEnd && (m.audioEnd ?? 0) < m.videoEnd - 1.5) events.warn?.(`audio stops ${Math.round(m.videoEnd - (m.audioEnd ?? 0))} s before the video`);
          resolve({ size: m.size, videoZero: zero, audioZero: zero, timing: 'capture' });
        }
      };
    });
    this.worker.postMessage(
      { t: 'start', takeId, name, video, audio, videoBitrate: BITRATE[kind], screen: kind === 'screen', failAudioAfter: testHook('failAudioAfter') },
      [video, audio].filter(Boolean) as unknown as Transferable[],
    );
  }

  get recording() {
    return !this.stopped;
  }

  async stop() {
    if (!this.stopped) {
      this.stopped = true;
      this.worker.postMessage({ t: 'stop' });
    }
    try {
      return await this.done;
    } finally {
      this.clones.forEach((t) => t.stop());
      this.worker.terminate();
    }
  }
}

// ------------------------------------------------------------------ fallback

const CAM_TYPES = [
  'video/mp4;codecs=avc1.640028,mp4a.40.2',
  'video/mp4;codecs=avc1.640028,opus',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
];
const SCREEN_TYPES = ['video/mp4;codecs=avc1.640028', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'];

export function pickMime(kind: 'cam' | 'screen') {
  return (kind === 'cam' ? CAM_TYPES : SCREEN_TYPES).find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
}

export const extFor = (mime: string) => (mime.startsWith('video/mp4') ? 'mp4' : 'webm');

class FileRecorder implements Recorder {
  readonly mime: string;
  readonly started: Promise<number>;
  private rec: MediaRecorder;
  private writer: SequentialWriter;
  private stoppedP: Promise<void>;
  private times: Promise<{ video: number; audio: number }>;

  constructor(
    readonly takeId: string,
    readonly name: string,
    stream: MediaStream,
    readonly kind: 'cam' | 'screen',
  ) {
    this.mime = pickMime(kind);
    this.writer = new SequentialWriter(takeId, name);
    this.rec = new MediaRecorder(stream, {
      mimeType: this.mime || undefined,
      videoBitsPerSecond: BITRATE[kind],
      audioBitsPerSecond: 128_000,
      videoKeyFrameIntervalDuration: 2000,
    } as MediaRecorderOptions);
    this.rec.ondataavailable = (e) => e.data.size && this.writer.write(e.data);
    // Best available estimate: video counts from start(), audio from the start event.
    const called = wall();
    this.times = new Promise((resolve) => (this.rec.onstart = () => resolve({ video: called, audio: wall() })));
    this.started = this.times.then((t) => t.video);
    this.stoppedP = new Promise((resolve) => (this.rec.onstop = () => resolve()));
    this.rec.start(1000);
  }

  get recording() {
    return this.rec.state === 'recording';
  }

  async stop(): Promise<RecorderResult> {
    if (this.rec.state !== 'inactive') this.rec.stop();
    await this.stoppedP;
    await this.writer.close();
    const t = await this.times;
    return { size: this.writer.written, videoZero: t.video, audioZero: t.audio, timing: 'estimated' };
  }
}
