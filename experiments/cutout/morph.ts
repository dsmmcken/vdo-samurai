// The morph between each box and the cutout, drawn by the app's engine at
// fixed points along it (as the final render does), over a slide: a contact
// sheet to judge it by eye. Also times the engine at both qualities.
import { CutoutEngine, type Quality } from '../../src/lib/cutout/engine';
import { BlazeFace } from '../../src/lib/face/blazeface';
import { headFromFace } from '../../src/lib/framing';
import { cutLayout, easeInOut, pipBox } from '../../src/lib/overlay';
import type { Corner, PipShape } from '../../src/lib/types';

const params = new URLSearchParams(location.search);
const photo = params.get('photo') ?? 'portrait.jpg';
const img = new Image();
img.src = `/photos/${photo}`;
await img.decode();
// A 1280x720 "webcam" picture: the photo, top-aligned, on a wall.
const cam = new OffscreenCanvas(1280, 720);
const cg = cam.getContext('2d')!;
cg.fillStyle = '#6d5a4a';
cg.fillRect(0, 0, 1280, 720);
const ph = 720 * 1.15;
const pw = (ph * img.naturalWidth) / img.naturalHeight;
cg.drawImage(img, 640 - pw / 2, 0, pw, ph);
const bmp = await createImageBitmap(cam);
const det = await BlazeFace.load('/app/assets/blaze_face_short_range.tflite', '/app/lib/nn/kernels.wasm');
const face = det.detect(bmp, 1280, 720)[0];
const head = face ? headFromFace(face, 1280, 720) : null;

const W = 1920, H = 1080;
const slide = (g: OffscreenCanvasRenderingContext2D) => {
  g.fillStyle = '#e8ecf3'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#3b5bdb'; g.fillRect(0, 0, W, 90);
  for (let i = 0; i < 12; i++) { g.fillStyle = '#99a'; g.fillRect(120, 300 + i * 60, 1600 - i * 90, 24); }
};
const lines: string[] = [];
const timing = async (q: Quality) => {
  const eng = new CutoutEngine(new OffscreenCanvas(1, 1), q);
  await eng.ready;
  const L = cutLayout('br', 'cutout', 1, head, 1280, 720);
  const t: number[] = [];
  for (let i = 0; i < 20; i++) {
    const f = new VideoFrame(bmp, { timestamp: i });
    eng.setFrame(f);
    f.close();
    const t0 = performance.now();
    eng.draw(L, 324, 360);
    eng.canvas.getContext('webgl2')!.finish();
    t.push(performance.now() - t0);
  }
  t.sort((a, b) => a - b);
  lines.push(`${q}: median ${t[10].toFixed(1)} ms per frame (segment + draw)`);
  eng.close();
};
await timing('live');
await timing('best');

const corner = (params.get('corner') ?? 'br') as Corner;
const boxes: PipShape[] = ['rect', 'circle'];
const steps = [0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9, 1];
const eng = new CutoutEngine(new OffscreenCanvas(1, 1), 'best');
await eng.ready;
const C = pipBox(corner, 'cutout');
const cw = 420, chh = 420; // each cell: the corner of the stage
const sx = corner.endsWith('r') ? W - cw : 0;
const sy = corner.startsWith('b') ? H - chh : 0;
const sheet = new OffscreenCanvas(cw * steps.length, chh * boxes.length);
const sg = sheet.getContext('2d')!;
const stage = new OffscreenCanvas(W, H);
const g = stage.getContext('2d')!;
for (const [row, box] of boxes.entries()) {
  for (const [col, k] of steps.entries()) {
    const c = easeInOut(k);
    for (let i = 0; i < 3; i++) {
      const f = new VideoFrame(bmp, { timestamp: col * 10 + i });
      eng.setFrame(f);
      f.close();
      const L = cutLayout(corner, box, c, head, 1280, 720);
      eng.draw(L, Math.round(L.bounds.w), Math.round(L.bounds.h));
    }
    const L = cutLayout(corner, box, c, head, 1280, 720);
    slide(g);
    g.save();
    g.shadowColor = 'rgba(0,0,0,0.5)';
    g.shadowBlur = 40 + (24 - 40) * c;
    g.shadowOffsetY = 10 + (8 - 10) * c;
    g.drawImage(eng.canvas, L.bounds.x, L.bounds.y, L.bounds.w, L.bounds.h);
    g.restore();
    // Where the face's centre is: should glide in a straight line.
    g.fillStyle = 'red';
    g.fillRect(L.map.px - 3, L.map.py - 3, 6, 6);
    sg.drawImage(stage, sx, sy, cw, chh, col * cw, row * chh, cw, chh);
    if (col === 0 || col === steps.length - 1) lines.push(`${box} k=${k}: face at (${L.map.px.toFixed(0)}, ${L.map.py.toFixed(0)}) scale ${L.map.k.toFixed(3)}`);
  }
}
lines.push(`cutout box ${JSON.stringify(C)}`);
const blob = await sheet.convertToBlob({ type: 'image/png' });
const b64 = await new Promise<string>((r) => {
  const fr = new FileReader();
  fr.onload = () => r((fr.result as string).split(',')[1]);
  fr.readAsDataURL(blob);
});
(window as unknown as { result: unknown }).result = { text: lines.join('\n'), images: { [`morph-${corner}.png`]: b64 } };
