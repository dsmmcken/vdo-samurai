// Page side of the cutout overlay. The person is drawn by a dedicated worker
// (lib/cutout/worker.ts) into a canvas it owns; this class only hands it
// camera pictures and where to draw, and runs the morph between the cutout
// and the boxed shapes (overlay.ts):
//
// 1. Box to cutout: the box keeps showing (it's the DOM <Video>) while the
//    worker finds the person in the current picture. The canvas, underneath,
//    already draws the morph's first frame: the same box. Once it has a mask
//    the box hides and the morph plays on the canvas.
// 2. Cutout to box: the morph plays at once; at its end the box (DOM) shows
//    again over the canvas's last frame, the same picture, and the canvas goes.
//
// The shape the overlay's frame (hit area, menu) uses, `shown`, follows the
// shared one once the morph starts, so its menu moves along with it.
import type { CutIn, CutOut } from '../lib/cutout/worker';
import { glide, type Head } from '../lib/framing';
import { simdSupported } from '../lib/nn/net';
import { CUTOUT_HEAD_TOP, cutLayout, cutoutHeadX, easeInOut, PIP_MOVE_S, pipCrop } from '../lib/overlay';
import type { Corner, PipShape } from '../lib/types';

export interface CutState {
  /** The shape the overlay frame shows (lags the shared one while a morph gets ready). */
  shown: PipShape;
  /**
   * The DOM picture: 'morphing' while hidden (the canvas draws the morph),
   * 'reveal' while it reappears over the canvas's last frame (at once, no fade).
   */
  face: 'shown' | 'morphing' | 'reveal';
  /** The canvas shows. */
  canvasOn: boolean;
  /** It fades in (appearing on its own, not as part of a morph). */
  fade: boolean;
  /** 'failed': no cutout here (no WebGL2 in workers, say): boxes instead. */
  status: 'idle' | 'loading' | 'live' | 'failed';
  /** Where the head is in the cutout (fractions across, and down to its top), for placing its menu. */
  headX: number;
  headTop: number;
}

export interface CutProps {
  shape: PipShape;
  corner: Corner;
  hidden: boolean;
  /** Camera off or no stream: nothing to cut out. */
  off: boolean;
  mirror: boolean;
  head: Head | null;
}

export const cutoutSupported = () =>
  simdSupported() && typeof VideoFrame !== 'undefined' && typeof OffscreenCanvas !== 'undefined' && 'transferControlToOffscreen' in HTMLCanvasElement.prototype;

const MOVE_MS = PIP_MOVE_S * 1000;

export class CutoutView {
  private state: CutState;
  private canvas = document.createElement('canvas');
  private worker: Worker | null = null;
  private video: HTMLVideoElement | null = null;
  private p: CutProps;
  private target: PipShape;
  private morph: { box: PipShape; toCut: boolean; start: number | null; ended: number } | null = null;
  private raf = 0;
  private busy = false;
  private newFrame = false;
  private reset = false;
  private id = 0;
  private shownHead: Head | null = null;
  private lastT = 0;
  private lastTime = -1;
  private hx: { from: number; start: number } | null = null;
  private hiddenAt = 0;
  private size = { w: 0, h: 0 };
  private sent = { w: 0, h: 0, c: -1 };
  private ro: ResizeObserver;

  constructor(
    private host: HTMLElement,
    props: CutProps,
    private onState: (s: CutState) => void,
  ) {
    this.p = props;
    this.target = props.shape;
    this.state = { shown: props.shape, face: 'shown', canvasOn: false, fade: false, status: 'idle', headX: cutoutHeadX(props.corner), headTop: CUTOUT_HEAD_TOP };
    host.append(this.canvas);
    this.ro = new ResizeObserver(([e]) => {
      const box = e.devicePixelContentBoxSize?.[0];
      this.size = box ? { w: box.inlineSize, h: box.blockSize } : { w: Math.round(e.contentRect.width * devicePixelRatio), h: Math.round(e.contentRect.height * devicePixelRatio) };
      this.loop();
    });
    this.ro.observe(this.canvas);
    this.setTarget(props.shape);
  }

  update(p: CutProps) {
    const now = performance.now();
    if (p.corner !== this.p.corner) this.hx = { from: this.headX(now), start: now };
    if (p.hidden !== this.p.hidden) this.hiddenAt = now;
    if (p.off !== this.p.off && p.off) this.finish();
    this.p = p;
    this.setTarget(p.shape);
    this.loop();
  }

  setStream(stream: MediaStream | null) {
    if (this.video) this.video.srcObject = null;
    this.video = null;
    if (!stream?.getVideoTracks().length) return;
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.srcObject = new MediaStream(stream.getVideoTracks());
    v.play().catch(() => {});
    const onFrame = () => {
      if (this.video !== v) return;
      this.newFrame = true;
      this.loop();
      v.requestVideoFrameCallback?.(onFrame);
    };
    // Without frame callbacks (older Firefox), tick() watches currentTime.
    v.requestVideoFrameCallback?.(onFrame);
    this.video = v;
    this.newFrame = true;
    this.loop();
  }

  /** Ends any morph now (a drag started, say). */
  finish() {
    const m = this.morph;
    if (!m) return;
    this.morph = null;
    this.set({ shown: this.target, face: 'shown', canvasOn: this.target === 'cutout' && this.state.status === 'live' });
  }

  close() {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.worker?.terminate();
    this.worker = null;
    if (this.video) this.video.srcObject = null;
    this.video = null;
    this.canvas.remove();
  }

  private set(s: Partial<CutState>) {
    const next = { ...this.state, ...s };
    if (Object.entries(next).every(([k, v]) => this.state[k as keyof CutState] === v)) return;
    this.state = next;
    this.onState(next);
  }

  private setTarget(shape: PipShape) {
    if (shape === 'cutout') this.start();
    if (shape === this.target && this.state.shown === shape && !this.morph) return;
    const prev = this.target;
    this.target = shape;
    const shown = this.state.shown;
    const status = this.state.status;
    // No morph: same shape, boxes only, can't cut out, or nothing to see.
    if (shape === shown && !this.morph) return;
    if ((shape !== 'cutout' && shown !== 'cutout') || status === 'failed' || this.p.hidden || this.p.off) {
      this.morph = null;
      this.set({ shown: shape, face: 'shown', canvasOn: shape === 'cutout' && status === 'live' });
      return;
    }
    const m = this.morph;
    const now = performance.now();
    if (m?.start != null && prev !== shape && (m.toCut ? shape === m.box : shape === 'cutout')) {
      // Changed back mid-morph: turn around from where it is.
      const done = Math.min(1, (now - m.start) / MOVE_MS);
      this.morph = { box: m.box, toCut: !m.toCut, start: now - (1 - done) * MOVE_MS, ended: 0 };
      this.set({ shown: shape, face: 'morphing', canvasOn: true, fade: false });
      return;
    }
    if (shape === 'cutout') {
      // From a box: wait for a fresh mask before the box gives way.
      this.morph = { box: shown === 'cutout' ? (m?.box ?? 'rect') : shown, toCut: true, start: null, ended: 0 };
      this.reset = true;
      this.set({ canvasOn: true, fade: false });
    } else {
      this.morph = { box: shape, toCut: false, start: now, ended: 0 };
      this.set({ shown: shape, face: 'morphing', canvasOn: true, fade: false });
    }
  }

  /** The worker, on first need. */
  private start() {
    if (this.worker || this.state.status === 'failed') return;
    if (!cutoutSupported()) {
      this.set({ status: 'failed' });
      return;
    }
    let offscreen: OffscreenCanvas;
    try {
      offscreen = this.canvas.transferControlToOffscreen();
    } catch (e) {
      console.warn('[cutout]', e);
      this.set({ status: 'failed' });
      return;
    }
    const w = new Worker(new URL('../lib/cutout/worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<CutOut>) => this.onMessage(e.data);
    w.onerror = (e) => this.onMessage({ t: 'error', message: e.message });
    w.postMessage({ t: 'init', canvas: offscreen } satisfies CutIn, [offscreen]);
    this.worker = w;
    this.set({ status: 'loading' });
  }

  private onMessage(m: CutOut) {
    if (m.t === 'ready') this.loop();
    else if (m.t === 'error') {
      console.warn('[cutout]', m.message);
      this.worker?.terminate();
      this.worker = null;
      this.morph = null;
      this.busy = false;
      this.set({ status: 'failed', shown: this.target, face: 'shown', canvasOn: false });
    } else if (m.t === 'drawn') {
      this.busy = false;
      if (!m.masked) return this.loop();
      if (this.state.status !== 'live') this.set({ status: 'live', canvasOn: this.state.canvasOn || this.target === 'cutout', fade: !this.morph });
      const mo = this.morph;
      if (mo?.toCut && mo.start === null && !this.reset) {
        // The canvas now shows the box as it was: swap, and go.
        mo.start = performance.now();
        this.set({ shown: 'cutout', face: 'morphing', canvasOn: true });
      }
      this.loop();
    }
  }

  private loop() {
    if (!this.raf) this.raf = requestAnimationFrame(this.tick);
  }

  /** Where the head sits in the (still) cutout: the crop may not centre it, near the frame's edge. */
  private placeHead(vw: number, vh: number, hx: number) {
    const h = this.shownHead;
    if (!h) return;
    const c = pipCrop(this.p.corner, 'cutout', h, vw, vh, this.p.mirror, hx);
    const x = (h.x * vw - c.x) / c.w;
    const round = (v: number) => Math.round(v * 50) / 50;
    // The head's box runs well above the hair (it allows for any hairstyle): the top of the hair is nearer this.
    this.set({ headX: round(this.p.mirror ? 1 - x : x), headTop: round(((h.y - h.s * 0.35) * vh - c.y) / c.h) });
  }

  private headX(now: number) {
    const to = cutoutHeadX(this.p.corner);
    if (!this.hx) return to;
    const k = Math.min(1, (now - this.hx.start) / MOVE_MS);
    const x = this.hx.from + (to - this.hx.from) * easeInOut(k);
    if (k >= 1) this.hx = null;
    return x;
  }

  private tick = (now: number) => {
    this.raf = 0;
    const dt = Math.min(0.1, (now - this.lastT) / 1000);
    this.lastT = now;
    const target = this.p.head;
    const prev = this.shownHead;
    this.shownHead = prev && target ? glide(prev, target, dt) : target;
    const gliding = !!(prev && target) && Math.abs(prev.x - target.x) + Math.abs(prev.y - target.y) + Math.abs(prev.s - target.s) > 1e-4;

    // Where the morph is: c = 1 is the cutout.
    const m = this.morph;
    let c = 1;
    let box: PipShape = 'cutout';
    if (m) {
      box = m.box;
      const k = m.start === null ? 0 : Math.min(1, (now - m.start) / MOVE_MS);
      c = m.toCut ? easeInOut(k) : 1 - easeInOut(k);
      if (k >= 1) {
        if (m.toCut) {
          this.morph = null;
          this.set({ face: 'shown' });
        } else if (!m.ended) {
          // The box shows again over the canvas's matching frame...
          m.ended = now;
          this.set({ face: 'reveal' });
        } else if (now - m.ended > 100) {
          // ...and once it has surely painted, the canvas goes.
          this.morph = null;
          this.set({ face: 'shown', canvasOn: false });
          return;
        }
      }
    } else if (this.state.shown !== 'cutout' || this.state.status === 'failed') return;
    if (this.p.off || (this.p.hidden && now - this.hiddenAt > MOVE_MS + 100)) return;

    const v = this.video;
    const w = this.worker;
    const hx = this.headX(now);
    const polled = v && !v.requestVideoFrameCallback;
    if (polled && v.currentTime !== this.lastTime) {
      this.lastTime = v.currentTime;
      this.newFrame = true;
    }
    const animating = !!m || gliding || !!this.hx;
    if (w && v && !this.busy && v.readyState >= 2 && v.videoWidth && this.size.w && this.size.h) {
      const changed = this.newFrame || this.reset || animating || this.sent.w !== this.size.w || this.sent.h !== this.size.h || this.sent.c !== c;
      if (changed) {
        let frame: VideoFrame | undefined;
        if (this.newFrame || this.reset) {
          try {
            frame = new VideoFrame(v);
          } catch {
            frame = undefined;
          }
        }
        const layout = cutLayout(this.p.corner, box, c, this.shownHead, v.videoWidth, v.videoHeight, this.p.mirror, hx);
        this.host.style.setProperty('--c', String(c)); // its shadow eases from the box's to the cutout's
        this.placeHead(v.videoWidth, v.videoHeight, hx);
        const msg: CutIn = { t: 'draw', frame, layout, w: this.size.w, h: this.size.h, id: ++this.id, reset: this.reset && !!frame };
        if (msg.reset) this.reset = false;
        this.newFrame = false;
        this.busy = true;
        this.sent = { w: this.size.w, h: this.size.h, c };
        w.postMessage(msg, frame ? [frame] : []);
      }
    }
    // Keep going while something moves; otherwise wake on the next camera frame.
    if (animating || this.busy || this.reset || polled) this.loop();
  };
}
