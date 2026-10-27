// Experiment 2: use VDO.Ninja only to bootstrap, then run our own signaling.
//   1. hub<->alice and hub<->bob meet through VDO.Ninja (two separate rooms, so
//      alice and bob never see each other there).
//   2. Over an app data channel (x-sig) on those SDK connections, each pair
//      negotiates a brand-new RTCPeerConnection that we own.
//   3. Signaling for our PCs moves onto their own 'ctl' data channel.
//   4. Everyone disconnects from VDO.Ninja entirely.
//   5. Renegotiate (add an audio track) with no VDO.Ninja involvement.
//   6. hub introduces alice to bob and relays their offer/answer/ICE; alice and
//      bob end up with a direct link, then the hub drops out.
import { startServer } from './server.mjs';
import { launchPeer, rand, sleep } from './common.mjs';
import fs from 'node:fs';

const { server, url } = await startServer();
const password = rand(12);
const rooms = { alice: `samurai_a_${rand()}`, bob: `samurai_b_${rand()}` };
const hub = await launchPeer(url, 'hub');
const alice = await launchPeer(url, 'alice');
const bob = await launchPeer(url, 'bob');
const peers = { hub, alice, bob };
const report = {};
const step = (k, v) => {
  report[k] = v;
  console.log(`\n== ${k}\n`, JSON.stringify(v, null, 1));
};
const state = (p, other) => p.page.evaluate((o) => lab.linkState(o), other);

try {
  for (const p of Object.values(peers)) await p.page.evaluate(() => lab.cam({ width: 640, height: 360, fps: 15 }));

  // 1. Bootstrap through VDO.Ninja.
  const boot = await Promise.all([
    hub.page.evaluate((o) => lab.bootstrap(o), { key: 'alice', room: rooms.alice, password, streamID: `h${rand(3)}` }),
    alice.page.evaluate((o) => lab.bootstrap(o), { key: 'hub', room: rooms.alice, password, streamID: `a${rand(3)}` }),
    hub.page.evaluate((o) => lab.bootstrap(o), { key: 'bob', room: rooms.bob, password, streamID: `h${rand(3)}` }),
    bob.page.evaluate((o) => lab.bootstrap(o), { key: 'hub', room: rooms.bob, password, streamID: `b${rand(3)}` }),
  ]);
  step('1 vdo bootstrap (remote uuids)', boot);

  // 2+3. Our own PCs, negotiated over x-sig, then self-hosted on ctl.
  const t0 = Date.now();
  const [hubA, aHub, hubB, bHub] = await Promise.all([
    hub.page.evaluate((o) => lab.linkViaVdo(o), { key: 'alice', uuid: boot[0], peer: 'alice', initiator: true }),
    alice.page.evaluate((o) => lab.linkViaVdo(o), { key: 'hub', uuid: boot[1], peer: 'hub', initiator: false }),
    hub.page.evaluate((o) => lab.linkViaVdo(o), { key: 'bob', uuid: boot[2], peer: 'bob', initiator: true }),
    bob.page.evaluate((o) => lab.linkViaVdo(o), { key: 'hub', uuid: boot[3], peer: 'hub', initiator: false }),
  ]);
  step('2 own PCs up via x-sig', { ms: Date.now() - t0, hubA, aHub, hubB, bHub });

  // 4. Leave VDO.Ninja completely.
  const torn = {};
  for (const [n, p] of Object.entries(peers)) torn[n] = await p.page.evaluate(() => lab.teardownVdo());
  await sleep(4000);
  const before = await state(alice, 'hub');
  await sleep(5000);
  const after = await state(alice, 'hub');
  step('4 after VDO.Ninja disconnect', {
    torn,
    hubAliceLink: after.state,
    aliceRxFramesIn5s: after.rx.frames - before.rx.frames,
    aliceRxKbps: Math.round(((after.rx.bytes - before.rx.bytes) * 8) / 5 / 1000),
  });

  // 5. Renegotiate with VDO.Ninja gone: alice adds an audio track.
  await alice.page.evaluate(() => lab.addAudio('hub'));
  await hub.page.waitForFunction(() => lab.links.alice.remoteTracks.includes('audio'), null, { timeout: 15000 });
  step('5 renegotiation over ctl', { hubSees: (await state(hub, 'alice')).remoteTracks, aliceSig: (await state(alice, 'hub')).sigMsgs });

  // 6. Hub-mediated introduction: alice <-> bob, signaled via hub relay.
  await hub.page.evaluate(() => lab.introduce('alice', 'bob'));
  await alice.page.waitForFunction(
    () => lab.links.bob?.pc.connectionState === 'connected' && lab.links.bob.transport === 'ctl',
    null,
    { timeout: 20000 },
  );
  const relayed = await hub.page.evaluate(() => lab.relayed);
  // Hub leaves; alice<->bob must survive and keep flowing.
  await hub.page.evaluate(() => (lab.dropLink('alice'), lab.dropLink('bob')));
  await sleep(3000);
  const ab1 = await state(alice, 'bob');
  await sleep(5000);
  const ab2 = await state(alice, 'bob');
  step('6 introduced alice<->bob', {
    hubRelayedSignalMsgs: relayed,
    aliceBobAfterHubLeft: ab2.state,
    candidatePair: ab2.pair,
    aliceSigMsgsToBob: ab2.sigMsgs,
    aliceRxFromBobIn5s: ab2.rx.frames - ab1.rx.frames,
    rxRes: `${ab2.rx.width}x${ab2.rx.height}`,
    rxKbps: Math.round(((ab2.rx.bytes - ab1.rx.bytes) * 8) / 5 / 1000),
  });
  report.ok = true;
} catch (e) {
  console.error('FAILED:', e);
  report.error = String(e);
} finally {
  fs.mkdirSync('results', { recursive: true });
  fs.writeFileSync('results/signaling.json', JSON.stringify(report, null, 2));
  for (const p of Object.values(peers)) await p.browser.close();
  server.close();
}
