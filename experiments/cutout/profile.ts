// Time per op type in our selfie segmenter.
import { Net } from '../../src/lib/nn/net';
const net = await Net.load('/app/assets/selfie_segmenter.tflite', '/app/lib/nn/kernels.wasm');
const steps = (net as unknown as { steps: (() => void)[] }).steps;
const tot = new Map<string, number>();
for (let r = 0; r < 30; r++)
  steps.forEach((s, i) => {
    const t0 = performance.now();
    s();
    const k = net.stepNames[i];
    if (r >= 5) tot.set(k, (tot.get(k) ?? 0) + performance.now() - t0);
  });
const byOp = new Map<string, number>();
for (const [k, v] of tot) byOp.set(k.split(' ')[0], (byOp.get(k.split(' ')[0]) ?? 0) + v / 25);
const top = [...tot].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => `${(v / 25).toFixed(2)} ms  ${k}`);
(window as unknown as { result: unknown }).result = { text: [...byOp].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${v.toFixed(2)} ms  ${k}`).join('\n') + '\n--- slowest steps\n' + top.join('\n') };
