// Same 256x256 picture into both: our runner's mask should match MediaPipe's
// ImageSegmenter (CPU) to a few thousandths.
import { FilesetResolver, ImageSegmenter } from '@mediapipe/tasks-vision';
import { Segmenter, SEG_SIZE } from '../../src/lib/cutout/segmenter';

const S = SEG_SIZE;
const photos = ['portrait.jpg', 'Kamala_Harris_Vice_Presidential_Portrait.jpg', 'Malala_Yousafzai_at_Girl_Summit_2014.jpg', 'Lionel_Messi_20180626.jpg', 'Serena_Williams_at_2013_US_Open.jpg', 'Albert_Einstein_Head.jpg'];

const ours = await Segmenter.load('/app/assets/selfie_segmenter.tflite', '/app/lib/nn/kernels.wasm');
const fileset = await FilesetResolver.forVisionTasks('/node_modules/@mediapipe/tasks-vision/wasm');
const mp = await ImageSegmenter.createFromOptions(fileset, {
  baseOptions: { modelAssetPath: '/app/assets/selfie_segmenter.tflite', delegate: 'CPU' },
  runningMode: 'IMAGE',
  outputCategoryMask: false,
  outputConfidenceMasks: true,
});

const lines: string[] = [];
const sheet = new OffscreenCanvas(S * 3, S * photos.length);
const sg = sheet.getContext('2d')!;
for (const [row, name] of photos.entries()) {
  const img = new Image();
  img.src = `/photos/${name}`;
  await img.decode();
  const c = new OffscreenCanvas(S, S);
  const g = c.getContext('2d', { willReadFrequently: true })!;
  // A portrait-ish crop, top-aligned, squashed to square (as the overlay does).
  const cw = img.naturalWidth;
  const ch = Math.min(img.naturalHeight, cw * 1.1);
  g.drawImage(img, 0, 0, cw, ch, 0, 0, S, S);
  const rgba = g.getImageData(0, 0, S, S).data;

  const t0 = performance.now();
  const a = ours.run(rgba).slice();
  const ms = performance.now() - t0;
  const b = mp.segment(c).confidenceMasks![0].getAsFloat32Array();
  let max = 0, sum = 0, fg = 0;
  for (let i = 0; i < a.length; i++) {
    const d = Math.abs(a[i] - b[i]);
    max = Math.max(max, d);
    sum += d;
    fg += b[i] > 0.5 ? 1 : 0;
  }
  const flip = ours.run(rgba, true);
  let flipDiff = 0;
  for (let i = 0; i < a.length; i++) flipDiff += Math.abs(flip[i] - a[i]);
  lines.push(`${name.padEnd(46)} max diff ${max.toFixed(4)}  mean ${(sum / a.length).toFixed(5)}  person ${((fg / a.length) * 100).toFixed(0)}%  flip-vs-plain mean ${(flipDiff / a.length).toFixed(4)}  (${ms.toFixed(1)} ms)`);

  // Contact sheet: picture, ours, MediaPipe.
  sg.drawImage(c, 0, row * S);
  for (const [col, m] of [a, b].entries()) {
    const im = new ImageData(S, S);
    for (let i = 0; i < m.length; i++) {
      const v = Math.round(m[i] * 255);
      im.data.set([v, v, v, 255], i * 4);
    }
    sg.putImageData(im, (col + 1) * S, row * S);
  }
}
const blob = await sheet.convertToBlob({ type: 'image/png' });
const b64 = await new Promise<string>((r) => {
  const fr = new FileReader();
  fr.onload = () => r((fr.result as string).split(',')[1]);
  fr.readAsDataURL(blob);
});
(window as unknown as { result: unknown }).result = { text: lines.join('\n'), images: { 'exact.png': b64 } };
