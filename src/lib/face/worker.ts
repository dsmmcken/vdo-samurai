// Face framing worker: receives small camera frames (ImageBitmap), finds the
// head, and replies with the calm framing anchor (see framing.ts).
import modelUrl from '../../assets/blaze_face_short_range.tflite?url';
import kernelsUrl from './kernels.wasm?url';
import { BlazeFace } from './blazeface';
import { FaceTracker } from './tracker';
import { Framer, headFromFace, roundHead, type Head } from '../framing';

export type FaceIn = { t: 'frame'; frame: ImageBitmap; at: number };
export type FaceOut = { t: 'ready' } | { t: 'head'; head: Head | null; ms: number } | { t: 'error'; message: string };

const post = (m: FaceOut) => (self as unknown as Worker).postMessage(m);

let tracker: FaceTracker | null = null;
const framer = new Framer();
const ready = BlazeFace.load(new URL(modelUrl, self.location.href).href, new URL(kernelsUrl, self.location.href).href).then(
  (det) => {
    tracker = new FaceTracker(det);
    post({ t: 'ready' });
  },
  (e) => post({ t: 'error', message: String(e?.message ?? e) }),
);

self.onmessage = async (e: MessageEvent<FaceIn>) => {
  const m = e.data;
  if (m.t !== 'frame') return;
  await ready;
  const { frame, at } = m;
  try {
    if (!tracker) return;
    const t = performance.now();
    const face = tracker.update(frame, frame.width, frame.height);
    const head = framer.update(face && headFromFace(face, frame.width, frame.height), frame.width / frame.height, at);
    post({ t: 'head', head: head && roundHead(head), ms: performance.now() - t });
  } catch (err) {
    post({ t: 'error', message: String((err as Error)?.message ?? err) });
  } finally {
    frame.close();
  }
};
