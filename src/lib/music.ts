// Waiting-room music: plays locally while you're alone in a room. Web Audio
// rather than <audio loop>, so the loop is seamless (no MP3 gap) and fades are
// smooth. Never while recording, so it can't leak into anyone's mic track.
import track from '../assets/waiting-room-music.mp3';

const LEVEL = 0.25; // about 12 dB under the track's mastered level: background, not foreground
const FADE_IN_S = 2;
const FADE_OUT_S = 1.5;

export class WaitingMusic {
  private ctx: AudioContext | null = null;
  private gain: GainNode | null = null;
  private source: AudioBufferSourceNode | null = null;
  private buffer: Promise<AudioBuffer> | null = null;
  private stopTimer: ReturnType<typeof setTimeout> | null = null;
  private muted = false;

  private setup() {
    if (this.ctx) return this.ctx;
    this.ctx = new AudioContext();
    this.gain = this.ctx.createGain();
    this.gain.gain.value = 0;
    this.gain.connect(this.ctx.destination);
    this.buffer = fetch(track)
      .then((r) => r.arrayBuffer())
      .then((b) => this.ctx!.decodeAudioData(b));
    return this.ctx;
  }

  /** Starts (or resumes) the loop with a fade in. */
  async play() {
    const ctx = this.setup();
    if (this.stopTimer) clearTimeout(this.stopTimer);
    this.stopTimer = null;
    await ctx.resume().catch(() => {});
    if (!this.source) {
      const buf = await this.buffer!;
      if (!this.ctx) return; // disposed while loading
      this.source = ctx.createBufferSource();
      this.source.buffer = buf;
      this.source.loop = true;
      this.source.connect(this.gain!);
      this.source.start();
    }
    this.ramp(this.muted ? 0 : LEVEL, FADE_IN_S);
  }

  /** Fades out (quickly when `fast`, e.g. recording is starting), then stops the loop. */
  stop(fast = false) {
    if (!this.ctx || !this.source) return;
    const seconds = fast ? 0.25 : FADE_OUT_S;
    this.ramp(0, seconds);
    if (this.stopTimer) clearTimeout(this.stopTimer);
    this.stopTimer = setTimeout(() => {
      this.source?.stop();
      this.source?.disconnect();
      this.source = null;
    }, seconds * 1000 + 100);
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    if (this.source) this.ramp(muted ? 0 : LEVEL, 0.3);
  }

  /** Same output device as everyone's voices (Chrome's AudioContext.setSinkId). */
  setSink(id: string | null) {
    const ctx = this.setup() as AudioContext & { setSinkId?: (id: string) => Promise<void> };
    ctx.setSinkId?.(id ?? '').catch(() => {});
  }

  private ramp(to: number, seconds: number) {
    const g = this.gain!.gain;
    const t = this.ctx!.currentTime;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(to, t + seconds);
  }

  dispose() {
    if (this.stopTimer) clearTimeout(this.stopTimer);
    this.source?.stop();
    this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.source = null;
  }
}

export function musicMutedPref() {
  try {
    return localStorage.getItem('samurai:music:muted') === '1';
  } catch {
    return false;
  }
}
export function setMusicMutedPref(muted: boolean) {
  try {
    localStorage.setItem('samurai:music:muted', muted ? '1' : '0');
  } catch {
    /* storage unavailable */
  }
}
