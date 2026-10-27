// Per-person voice polish for the final mix, run on mono 48 kHz audio:
//   high-pass 80 Hz → de-esser → leveler → compressor
// followed (in worker.ts) by loudness normalization to −16 LUFS and, on the
// mixed bus, a look-ahead peak limiter. All settings are tuned for speech.

const RATE = 48000;
const db = (x: number) => 20 * Math.log10(Math.max(x, 1e-9));
const fromDb = (d: number) => 10 ** (d / 20);
/** One-pole smoothing coefficient for a time constant in seconds. */
const coef = (seconds: number) => Math.exp(-1 / (seconds * RATE));

class Biquad {
  private s1 = 0;
  private s2 = 0;
  constructor(
    private b0: number,
    private b1: number,
    private b2: number,
    private a1: number,
    private a2: number,
  ) {}

  /** RBJ cookbook high-pass. */
  static highpass(f: number, q = Math.SQRT1_2) {
    const w = (2 * Math.PI * f) / RATE;
    const cos = Math.cos(w);
    const alpha = Math.sin(w) / (2 * q);
    const a0 = 1 + alpha;
    return new Biquad((1 + cos) / 2 / a0, -(1 + cos) / a0, (1 + cos) / 2 / a0, (-2 * cos) / a0, (1 - alpha) / a0);
  }

  /** RBJ cookbook band-pass (constant 0 dB peak). */
  static bandpass(f: number, q: number) {
    const w = (2 * Math.PI * f) / RATE;
    const cos = Math.cos(w);
    const alpha = Math.sin(w) / (2 * q);
    const a0 = 1 + alpha;
    return new Biquad(alpha / a0, 0, -alpha / a0, (-2 * cos) / a0, (1 - alpha) / a0);
  }

  step(x: number) {
    const y = this.b0 * x + this.s1;
    this.s1 = this.b1 * x - this.a1 * y + this.s2;
    this.s2 = this.b2 * x - this.a2 * y;
    return y;
  }
}

export interface ChainStats {
  /** Average leveler gain while speaking, dB. */
  levelerDb: number;
  /** Average compressor reduction while speaking, dB. */
  compressionDb: number;
  /** Share of speaking time the de-esser was active. */
  deEss: number;
}

export class VoiceChain {
  // 1. rumble: 4th-order Butterworth high-pass at 80 Hz (24 dB/octave)
  private hp1 = Biquad.highpass(80, 0.5412);
  private hp2 = Biquad.highpass(80, 1.3066);
  // 2. de-esser: sibilance band and a broadband reference
  private sibBand = Biquad.bandpass(6500, 0.7);
  private sibEnv = 0;
  private fullEnv = 0;
  private deEssGain = 1;
  // 3. leveler: slow RMS toward a target while speaking; holds through silence
  private levRms = 0;
  private levGainDb = 0;
  // 4. compressor
  private compEnv = 0;
  private levLin = 1;
  private compLin = 1;
  private reduce = 0;
  private isSpeech = false;
  private tick = 0;
  // stats
  private speaking = 0;
  private sumLev = 0;
  private sumComp = 0;
  private sumDeEss = 0;
  /** |output| histogram in 0.5 dB bins from −60 dBFS up, for peak-aware normalization. */
  readonly peakHist = new Float64Array(132);

  // Tuning (speech)
  private static LEVEL_TARGET_DB = -20; // short-term RMS the leveler aims for
  private static LEVEL_RANGE_DB = 12; // most it will boost or cut
  private static GATE_DB = -50; // below this it's not speech: hold the leveler
  private static COMP_THRESHOLD_DB = -18;
  private static COMP_RATIO = 3;
  private static COMP_KNEE_DB = 6;
  private static SIB_RATIO = 0.6; // sibilance may be at most this loud relative to the rest of the voice

  private aEnvFast = coef(0.005);
  private rEnvFast = coef(0.06);
  private levAvg = coef(0.4); // RMS window for the leveler
  private levMove16 = Math.exp(-16 / (2.5 * RATE)); // leveler gain follows over ~2.5 s (updated every 16 samples)
  private compAttack = coef(0.005);
  private compRelease = coef(0.12);

  /** Processes mono samples in place and returns them. */
  process(x: Float32Array): Float32Array {
    const C = VoiceChain;
    for (let i = 0; i < x.length; i++) {
      // 1. high-pass
      let v = this.hp2.step(this.hp1.step(x[i]));

      // 2. de-esser: when the 5-10 kHz band dominates, pull it down.
      const sib = this.sibBand.step(v);
      const as = Math.abs(sib);
      const av = Math.abs(v - sib); // the rest of the voice
      this.sibEnv = as > this.sibEnv ? this.aEnvFast * this.sibEnv + (1 - this.aEnvFast) * as : this.rEnvFast * this.sibEnv + (1 - this.rEnvFast) * as;
      this.fullEnv = av > this.fullEnv ? this.aEnvFast * this.fullEnv + (1 - this.aEnvFast) * av : this.rEnvFast * this.fullEnv + (1 - this.rEnvFast) * av;
      const allowed = C.SIB_RATIO * this.fullEnv;
      const target = this.sibEnv > allowed && this.fullEnv > 1e-4 ? allowed / this.sibEnv : 1;
      this.deEssGain = target < this.deEssGain ? target : this.deEssGain + (target - this.deEssGain) * 0.002;
      v = v - sib + sib * this.deEssGain;

      // 3. leveler: slow gain toward the target RMS, frozen in silence.
      // 4. compressor (soft knee) on the leveled signal.
      // Envelopes run per sample; gains are recomputed every 16 samples (0.33 ms),
      // far finer than speech dynamics, which keeps log10 off the hot path.
      this.levRms = this.levAvg * this.levRms + (1 - this.levAvg) * v * v;
      const lv = v * this.levLin;
      const a = Math.abs(lv);
      this.compEnv = a > this.compEnv ? this.compAttack * this.compEnv + (1 - this.compAttack) * a : this.compRelease * this.compEnv + (1 - this.compRelease) * a;
      if ((this.tick++ & 15) === 0) {
        const levelDb = db(Math.sqrt(this.levRms));
        this.isSpeech = levelDb > C.GATE_DB;
        if (this.isSpeech) {
          const want = Math.max(-C.LEVEL_RANGE_DB, Math.min(C.LEVEL_RANGE_DB, C.LEVEL_TARGET_DB - levelDb));
          this.levGainDb = this.levMove16 * this.levGainDb + (1 - this.levMove16) * want;
          this.levLin = fromDb(this.levGainDb);
        }
        const over = db(this.compEnv) - C.COMP_THRESHOLD_DB;
        const k = C.COMP_KNEE_DB / 2;
        this.reduce = over <= -k ? 0 : over >= k ? over * (1 - 1 / C.COMP_RATIO) : ((over + k) ** 2 / (2 * C.COMP_KNEE_DB)) * (1 - 1 / C.COMP_RATIO);
        this.compLin = fromDb(-this.reduce);
      }
      v = lv * this.compLin;
      const isSpeech = this.isSpeech;
      const reduce = this.reduce;

      x[i] = v;
      const av2 = Math.abs(v);
      if (av2 > 0.001) this.peakHist[Math.min(131, Math.max(0, Math.floor((db(av2) + 60) * 2)))]++;
      if (isSpeech) {
        this.speaking++;
        this.sumLev += this.levGainDb;
        this.sumComp += reduce;
        if (this.deEssGain < 0.9) this.sumDeEss++;
      }
    }
    return x;
  }

  /** Level (dBFS) that only the loudest `share` of samples exceed. */
  peakDb(share = 0.0005): number {
    const total = this.peakHist.reduce((a, b) => a + b, 0);
    let above = 0;
    for (let b = this.peakHist.length - 1; b >= 0; b--) {
      above += this.peakHist[b];
      if (above >= total * share) return b / 2 - 60;
    }
    return -60;
  }

  stats(): ChainStats {
    const n = Math.max(1, this.speaking);
    return { levelerDb: this.sumLev / n, compressionDb: this.sumComp / n, deEss: this.sumDeEss / n };
  }
}

/**
 * Look-ahead peak limiter for the final stereo mix: delays the audio 5 ms so
 * gain can come down before a peak arrives, then recovers over ~100 ms. The
 * ceiling sits at −1.5 dBFS so even peaks between samples stay under −1 dBTP.
 */
export class Limiter {
  static readonly LOOKAHEAD = 240; // 5 ms; callers compensate for this delay
  static readonly CEILING_DB = -1.5;
  private static CEILING = fromDb(Limiter.CEILING_DB);
  private bufL = new Float32Array(Limiter.LOOKAHEAD);
  private bufR = new Float32Array(Limiter.LOOKAHEAD);
  private pos = 0;
  private n = 0; // samples seen
  // Sliding-window maximum over the last LOOKAHEAD peaks (monotonic deque).
  private dqVal = new Float32Array(Limiter.LOOKAHEAD + 1);
  private dqIdx = new Float64Array(Limiter.LOOKAHEAD + 1);
  private head = 0;
  private tail = 0;
  private gain = 1;
  private release = coef(0.1);
  reduced = 0; // samples where the limiter was working
  reductionDbSum = 0; // for the average reduction (dB) while working

  process(L: Float32Array, R: Float32Array) {
    const N = Limiter.LOOKAHEAD;
    const cap = N + 1;
    for (let i = 0; i < L.length; i++) {
      const peak = Math.max(Math.abs(L[i]), Math.abs(R[i]));
      const idx = this.n++;
      // push, dropping smaller values from the back
      while (this.tail !== this.head && this.dqVal[(this.tail - 1 + cap) % cap] <= peak) this.tail = (this.tail - 1 + cap) % cap;
      this.dqVal[this.tail] = peak;
      this.dqIdx[this.tail] = idx;
      this.tail = (this.tail + 1) % cap;
      // drop values that left the window
      while (this.dqIdx[this.head] <= idx - N) this.head = (this.head + 1) % cap;
      const windowMax = this.dqVal[this.head];

      const target = windowMax > Limiter.CEILING ? Limiter.CEILING / windowMax : 1;
      this.gain = target < this.gain ? target : this.release * this.gain + (1 - this.release) * target;
      if (this.gain < 0.999) {
        this.reduced++;
        this.reductionDbSum -= db(this.gain);
      }
      // output the sample from LOOKAHEAD ago, with the gain that saw it coming
      const outL = this.bufL[this.pos];
      const outR = this.bufR[this.pos];
      this.bufL[this.pos] = L[i];
      this.bufR[this.pos] = R[i];
      this.pos = (this.pos + 1) % N;
      L[i] = outL * this.gain;
      R[i] = outR * this.gain;
    }
  }
}
