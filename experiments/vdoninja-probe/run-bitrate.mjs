// Experiment 1: can our client hold a VDO.Ninja-signaled webcam stream to a very
// low bitrate, and what does that save in bandwidth and encoder CPU?
import { startServer } from './server.mjs';
import { launchPeer, rand, sleep } from './common.mjs';
import fs from 'node:fs';

const PROFILES = [
  { label: '720p30 uncapped', width: 1280, height: 720, fps: 30, maxBitrate: null },
  { label: '360p15 @300k', width: 640, height: 360, fps: 15, maxBitrate: '300kbps' },
  { label: '180p10 @100k', width: 320, height: 180, fps: 10, maxBitrate: '100kbps' },
  { label: '120p8 @40k', width: 160, height: 120, fps: 8, maxBitrate: '40kbps' },
  { label: '120p5 @20k', width: 160, height: 120, fps: 5, maxBitrate: '20kbps' },
];
// INITIAL=1: cap is set in publish() before any viewer connects, instead of live.
const INITIAL = process.env.INITIAL === '1';
if (INITIAL) PROFILES.splice(0, PROFILES.length, { label: 'publish-time 120p8 @40k', width: 160, height: 120, fps: 8, maxBitrate: '40kbps', initial: true });
const SETTLE_MS = 6000;
const MEASURE_MS = 10000;

const { server, url } = await startServer();
const room = `samurai_probe_${rand()}`;
const password = rand(12);
const streamID = `pub${rand(4)}`;
const pub = await launchPeer(url, 'pub');
const sub = await launchPeer(url, 'sub');
const results = [];

try {
  const cam = INITIAL ? { width: 160, height: 120, fps: 8 } : { width: 1280, height: 720, fps: 30 };
  const media = INITIAL ? { video: { maxBitrate: '40kbps' } } : null;
  const settings = await pub.page.evaluate((c) => lab.cam(c), cam);
  console.log('camera:', `${settings.width}x${settings.height}@${settings.frameRate}`);
  await pub.page.evaluate((o) => lab.publish(o), { room, password, streamID, media });
  await sub.page.evaluate((o) => lab.view(o), { room, password, streamID });
  await sub.page.waitForFunction(
    async () => (await lab.sample()).rows.some((r) => r.rx?.frames > 0),
    null,
    { timeout: 30000, polling: 500 },
  );
  console.log('viewer is decoding frames via VDO.Ninja-signaled connection\n');

  for (const p of PROFILES) {
    const applied = p.initial
      ? await pub.page.evaluate(() => lab.senderInfo())
      : await pub.page.evaluate((p) => lab.setProfile(p), p);
    // First window also lets bandwidth estimation ramp up to the uncapped rate.
    await sleep(results.length === 0 ? 20000 : SETTLE_MS);
    const a = await snapshot();
    await sleep(MEASURE_MS);
    const b = await snapshot();
    const row = summarize(p, applied, a, b);
    results.push(row);
    console.log(p.label.padEnd(18), JSON.stringify(row.measured));
  }
} finally {
  fs.mkdirSync('results', { recursive: true });
  fs.writeFileSync(INITIAL ? 'results/bitrate-initial.json' : 'results/bitrate.json', JSON.stringify(results, null, 2));
  await pub.browser.close();
  await sub.browser.close();
  server.close();
}

async function snapshot() {
  const [ps, ss, pc, sc] = await Promise.all([
    pub.page.evaluate(() => lab.sample()),
    sub.page.evaluate(() => lab.sample()),
    pub.cpuSeconds(),
    sub.cpuSeconds(),
  ]);
  return { tx: ps.rows.find((r) => r.tx)?.tx, rx: ss.rows.find((r) => r.rx)?.rx, t: Date.now(), pc, sc };
}

function summarize(p, applied, a, b) {
  const dt = (b.t - a.t) / 1000;
  const r1 = (x) => Math.round(x * 10) / 10;
  return {
    profile: p,
    applied: { capture: applied.capture, senderParams: applied.senderParams },
    measured: {
      txKbps: r1(((b.tx.bytes - a.tx.bytes) * 8) / dt / 1000),
      txRes: `${b.tx.width}x${b.tx.height}`,
      txFps: r1((b.tx.frames - a.tx.frames) / dt),
      encodeBusyPct: r1(((b.tx.encodeTime - a.tx.encodeTime) / dt) * 100),
      limit: b.tx.limit,
      codec: `${b.tx.codec}/${b.tx.encoder}`,
      rxKbps: r1(((b.rx.bytes - a.rx.bytes) * 8) / dt / 1000),
      rxRes: `${b.rx.width}x${b.rx.height}`,
      rxFps: r1((b.rx.frames - a.rx.frames) / dt),
      decodeBusyPct: r1(((b.rx.decodeTime - a.rx.decodeTime) / dt) * 100),
      pubCpuPct: r1(((b.pc - a.pc) / dt) * 100),
      subCpuPct: r1(((b.sc - a.sc) / dt) * 100),
    },
  };
}
