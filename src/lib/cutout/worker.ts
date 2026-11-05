// The live cutout's own worker: it owns the overlay's canvas (transferred
// here) and does all the work, finding the person and drawing them. The page
// only hands it camera pictures (VideoFrames, which cost nothing to pass on)
// and where to draw. `reset` forgets the last mask (it's from a while ago).
import type { CutLayout } from '../overlay';
import { CutoutEngine } from './engine';

export type CutIn = { t: 'init'; canvas: OffscreenCanvas } | { t: 'draw'; frame?: VideoFrame; layout: CutLayout; w: number; h: number; id: number; reset?: boolean };
export type CutOut = { t: 'ready' } | { t: 'drawn'; id: number; masked: boolean } | { t: 'error'; message: string };

const post = (m: CutOut) => (self as unknown as Worker).postMessage(m);
const fail = (e: unknown) => post({ t: 'error', message: String((e as Error)?.message ?? e) });

let engine: CutoutEngine | null = null;

self.onmessage = (e: MessageEvent<CutIn>) => {
  const m = e.data;
  if (m.t === 'init') {
    try {
      engine = new CutoutEngine(m.canvas, 'live');
      engine.ready.then(() => post({ t: 'ready' }), fail);
    } catch (err) {
      fail(err);
    }
    return;
  }
  try {
    if (m.reset) engine?.reset();
    if (m.frame) engine?.setFrame(m.frame);
    post({ t: 'drawn', id: m.id, masked: engine?.draw(m.layout, m.w, m.h) ?? false });
  } catch (err) {
    post({ t: 'drawn', id: m.id, masked: false });
    fail(err);
  } finally {
    m.frame?.close();
  }
};
