// Time per frame of our selfie segmenter (one thread, WebAssembly SIMD): what
// the live worker spends per camera frame, and the final render twice over.
import { Segmenter, SEG_SIZE } from '../../src/lib/cutout/segmenter';

const seg = await Segmenter.load('/app/assets/selfie_segmenter.tflite', '/app/lib/nn/kernels.wasm');
const rgba = new Uint8Array(SEG_SIZE * SEG_SIZE * 4).map((_, i) => (i * 37) & 255);
for (let i = 0; i < 5; i++) seg.run(rgba);
const t: number[] = [];
for (let i = 0; i < 40; i++) {
  const t0 = performance.now();
  seg.run(rgba);
  t.push(performance.now() - t0);
}
t.sort((a, b) => a - b);
(window as unknown as { result: unknown }).result = { text: `segmenter: median ${t[20].toFixed(1)} ms, fastest ${t[0].toFixed(1)} ms, slowest ${t[39].toFixed(1)} ms (${navigator.hardwareConcurrency} cores here)` };
