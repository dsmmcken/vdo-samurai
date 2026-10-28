// Main-thread side of auto-framing: a few times a second, takes a small copy
// of the camera picture and hands it to the face worker, which replies with
// the framing anchor. Costs a few ms of worker time per frame, nothing on the
// main thread beyond the copy.
import { faceDetectionSupported } from './blazeface';
import { DETECT_HZ, sameHead, type Head } from '../framing';
import type { FaceIn, FaceOut } from './worker';

const WIDTH = 640; // frames go to the detector at this width (plenty for a face at webcam distance)

export class FaceWatch {
  private worker: Worker | null = null;
  private video: HTMLVideoElement | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private busy = false;
  private head: Head | null = null;

  constructor(private onHead: (h: Head | null) => void) {}

  /** Watch this camera track (null: pause; the last anchor stays). */
  setTrack(track: MediaStreamTrack | null) {
    this.stopVideo();
    if (!track || !faceDetectionSupported()) return;
    this.worker ??= this.startWorker();
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.srcObject = new MediaStream([track]);
    v.play().catch(() => {});
    this.video = v;
    this.timer = setInterval(() => this.grab(), 1000 / DETECT_HZ);
  }

  stop() {
    this.stopVideo();
    this.worker?.terminate();
    this.worker = null;
  }

  private startWorker() {
    const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<FaceOut>) => {
      const m = e.data;
      if (m.t === 'head') {
        this.busy = false;
        if (!sameHead(m.head, this.head)) {
          this.head = m.head;
          this.onHead(m.head);
        }
      } else if (m.t === 'error') {
        this.busy = false;
        console.warn('[framing]', m.message);
      }
    };
    return w;
  }

  private async grab() {
    const v = this.video;
    if (!v || this.busy || v.readyState < 2 || !v.videoWidth || !this.worker) return;
    this.busy = true; // one frame in flight at a time
    try {
      const frame = await createImageBitmap(v, { resizeWidth: WIDTH, resizeHeight: Math.round((WIDTH * v.videoHeight) / v.videoWidth), resizeQuality: 'medium' });
      if (this.video !== v || !this.worker) {
        frame.close();
        this.busy = false;
        return;
      }
      this.worker.postMessage({ t: 'frame', frame, at: performance.now() } satisfies FaceIn, [frame]);
    } catch {
      this.busy = false;
    }
  }

  private stopVideo() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.video) {
      this.video.srcObject = null;
      this.video = null;
    }
    this.busy = false;
  }
}
