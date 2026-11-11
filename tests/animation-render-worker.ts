// A stand-in for the render worker (animation-check.ts): opens an animation the way the
// compositor does, through the page, and reports one pixel of a frame.
import { AnimationSandbox, useSpawn } from '../src/lib/animation-sandbox';
import { spawnViaPage } from '../src/lib/animation-host';

useSpawn(spawnViaPage((m, transfer) => postMessage(m, transfer), (fn) => addEventListener('message', (e) => fn((e as MessageEvent).data))));

addEventListener('message', async (e) => {
  if (typeof e.data?.code !== 'string') return;
  try {
    const { sandbox, meta } = await AnimationSandbox.open(e.data.code);
    const bm = await sandbox.bitmap(0.5);
    const g = new OffscreenCanvas(bm.width, bm.height).getContext('2d')!;
    g.drawImage(bm, 0, 0);
    postMessage({ name: meta.name, px: [...g.getImageData(10, 10, 1, 1).data] });
    sandbox.close();
  } catch (err) {
    postMessage({ error: (err as Error).message });
  }
});
