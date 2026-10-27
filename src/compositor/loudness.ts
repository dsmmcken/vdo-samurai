// Integrated loudness per ITU-R BS.1770 (the measure behind EBU R128 / LUFS):
// K-weighting, 400 ms blocks every 100 ms, absolute gate at −70 LUFS and a
// relative gate 10 LU below the ungated mean. Input is mono-summed at 48 kHz.

type Biquad = { b0: number; b1: number; b2: number; a1: number; a2: number };
// BS.1770 K-weighting coefficients for 48 kHz: high shelf, then high-pass.
const SHELF: Biquad = { b0: 1.53512485958697, b1: -2.69169618940638, b2: 1.19839281085285, a1: -1.69065929318241, a2: 0.73248077421585 };
const HIGHPASS: Biquad = { b0: 1, b1: -2, b2: 1, a1: -1.99004745483398, a2: 0.99007225036621 };

export class LoudnessMeter {
  private s1 = [0, 0]; // filter state (direct form II transposed): shelf, then high-pass
  private s2 = [0, 0];
  private step = 4800; // 100 ms at 48 kHz
  private acc = 0; // sum of squares in the current 100 ms step
  private n = 0;
  private steps: number[] = []; // mean square per 100 ms step

  /** Feed mono samples at 48 kHz. */
  push(x: Float32Array) {
    const [a, b] = this.s1;
    let s1a = a;
    let s1b = b;
    let [s2a, s2b] = this.s2;
    for (let i = 0; i < x.length; i++) {
      // direct form II transposed, twice
      const v = x[i];
      const y1 = SHELF.b0 * v + s1a;
      s1a = SHELF.b1 * v - SHELF.a1 * y1 + s1b;
      s1b = SHELF.b2 * v - SHELF.a2 * y1;
      const y2 = HIGHPASS.b0 * y1 + s2a;
      s2a = HIGHPASS.b1 * y1 - HIGHPASS.a1 * y2 + s2b;
      s2b = HIGHPASS.b2 * y1 - HIGHPASS.a2 * y2;
      this.acc += y2 * y2;
      if (++this.n === this.step) {
        this.steps.push(this.acc / this.step);
        this.acc = 0;
        this.n = 0;
      }
    }
    this.s1 = [s1a, s1b];
    this.s2 = [s2a, s2b];
  }

  /** Integrated loudness in LUFS, or null if there was no speech-level signal. */
  integrated(): number | null {
    const blocks: number[] = [];
    for (let i = 0; i + 4 <= this.steps.length; i++) blocks.push((this.steps[i] + this.steps[i + 1] + this.steps[i + 2] + this.steps[i + 3]) / 4);
    const lufs = (ms: number) => -0.691 + 10 * Math.log10(ms);
    const abs = blocks.filter((ms) => ms > 0 && lufs(ms) > -70);
    if (!abs.length) return null;
    const mean = abs.reduce((x, y) => x + y, 0) / abs.length;
    const rel = abs.filter((ms) => lufs(ms) > lufs(mean) - 10);
    return lufs(rel.reduce((x, y) => x + y, 0) / rel.length);
  }
}
