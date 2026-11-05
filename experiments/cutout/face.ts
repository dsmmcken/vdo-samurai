// BlazeFace on the shared runner (src/lib/nn) still matches MediaPipe's FaceDetector.
import { FilesetResolver, FaceDetector } from '@mediapipe/tasks-vision';
import { BlazeFace } from '../../src/lib/face/blazeface';

const ours = await BlazeFace.load('/app/assets/blaze_face_short_range.tflite', '/app/lib/nn/kernels.wasm');
const fs = await FilesetResolver.forVisionTasks('/node_modules/@mediapipe/tasks-vision/wasm');
const mp = await FaceDetector.createFromOptions(fs, { baseOptions: { modelAssetPath: '/app/assets/blaze_face_short_range.tflite', delegate: 'CPU' }, runningMode: 'IMAGE', minDetectionConfidence: 0.3 });
const lines: string[] = [];
for (const name of ['portrait.jpg', 'Kamala_Harris_Vice_Presidential_Portrait.jpg', 'Lionel_Messi_20180626.jpg']) {
  const img = new Image();
  img.src = `/photos/${name}`;
  await img.decode();
  const c = new OffscreenCanvas(128, 128);
  c.getContext('2d')!.drawImage(img, 0, 0, 128, 128);
  const bmp = await createImageBitmap(c);
  const a = ours.detect(bmp, 128, 128, { minScore: 0.3 })[0];
  const b = mp.detect(bmp).detections[0];
  lines.push(`${name}: ours ${a && [a.x, a.y, a.w, a.score].map((v) => v.toFixed(3))}  mp ${b && [b.boundingBox!.originX, b.boundingBox!.originY, b.boundingBox!.width, b.categories[0].score].map((v) => v.toFixed(3))}`);
}
(window as unknown as { result: unknown }).result = { text: lines.join('\n') };
