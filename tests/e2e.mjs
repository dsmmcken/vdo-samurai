// End-to-end: three headless Chromium peers meet through wss.vdo.ninja, record a
// short take with stage switches, upload to the director, and render the cut.
// Usage: npm run build && node tests/e2e.mjs   (writes test-results/final.mp4)
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

const PORT = 4179;
const CHROME = process.env.CHROME || `${os.homedir()}/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome`;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = () => Math.random().toString(36).slice(2, 8);
await sleep(1500);

// Stand-in for getDisplayMedia: an animated 1920x1080 canvas.
const fakeScreen = () => {
  navigator.mediaDevices.getDisplayMedia = async () => {
    if (localStorage.getItem('samurai:test:stillScreen')) {
      // A screen nobody touches: drawn once, so capture delivers almost no frames.
      const c = document.createElement('canvas');
      c.width = 1920;
      c.height = 1080;
      const g = c.getContext('2d');
      g.fillStyle = '#5b2a86';
      g.fillRect(0, 0, 1920, 1080);
      g.fillStyle = '#fff';
      g.font = 'bold 120px sans-serif';
      g.fillText('STILL SCREEN', 400, 560);
      const stream = c.captureStream(30);
      // Like a real screen: one paint after capture starts, then nothing changes.
      setTimeout(() => g.fillRect(0, 0, 1, 1), 200);
      return stream;
    }
    const c = document.createElement('canvas');
    c.width = 1920;
    c.height = 1080;
    const g = c.getContext('2d');
    let n = 0;
    setInterval(() => {
      g.fillStyle = `hsl(${(n * 3) % 360} 60% 40%)`;
      g.fillRect(0, 0, 1920, 1080);
      g.fillStyle = '#fff';
      g.font = 'bold 120px sans-serif';
      g.fillText(`SCREEN ${n++}`, 200, 560);
      // Wall clock in 10 ms units as 24 black/white blocks: lets the test read
      // exactly when each output frame was captured.
      const v = Math.floor(Date.now() / 10) & 0xffffff;
      for (let b = 0; b < 24; b++) {
        g.fillStyle = (v >> b) & 1 ? '#fff' : '#000';
        g.fillRect(b * 60, 0, 60, 60);
      }
    }, 16);
    return c.captureStream(30);
  };
  // Microphone stand-in: a 1 kHz beep for 100 ms at the start of every wall-clock
  // second divisible by 7, so audio alignment can be measured too.
  const gum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = async (c) => {
    const s = await gum(c);
    if (c?.video) {
      // Camera stand-in: same wall-clock barcode, on a dark green background.
      const cv = document.createElement('canvas');
      cv.width = 1920;
      cv.height = 1080;
      const g = cv.getContext('2d');
      setInterval(() => {
        g.fillStyle = '#1b5e20';
        g.fillRect(0, 0, 1920, 1080);
        const v = Math.floor(Date.now() / 10) & 0xffffff;
        for (let b = 0; b < 24; b++) {
          g.fillStyle = (v >> b) & 1 ? '#fff' : '#000';
          g.fillRect(240 + b * 60, 0, 60, 60);
        }
      }, 16);
      for (const t of s.getVideoTracks()) {
        s.removeTrack(t);
        t.stop();
      }
      s.addTrack(cv.captureStream(30).getVideoTracks()[0]);
    }
    if (!c?.audio) return s;
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    osc.frequency.value = 1000;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const dst = ctx.createMediaStreamDestination();
    osc.connect(gain).connect(dst);
    osc.start();
    setInterval(() => {
      const t = Date.now();
      gain.gain.setValueAtTime(Math.floor(t / 1000) % 7 === 0 && t % 1000 < 100 ? 0.5 : 0, ctx.currentTime);
    }, 2);
    for (const t of s.getAudioTracks()) {
      s.removeTrack(t);
      t.stop();
    }
    s.addTrack(dst.stream.getAudioTracks()[0]);
    return s;
  };
};

const room = `e2e-${rand()}`;
const pw = `${rand()}${rand()}`;
const url = `http://localhost:${PORT}/#room=${room}&pw=${pw}`;
const urlNoPw = `http://localhost:${PORT}/#room=${room}`; // the third person types the password
const people = [
  ['Dana Director', 'Host'],
  ['Sam Screen', 'Presenter'],
  ['Cam Only', 'Guest'],
];
const browsers = [];
const pages = [];
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

try {
  for (const [i, [name, subtitle]] of people.entries()) {
    const b = await chromium.launch({
      executablePath: CHROME,
      args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
    });
    browsers.push(b);
    const page = await (await b.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
    page.on('pageerror', (e) => log(name, 'PAGEERROR', e.message));
    page.on('console', (m) => (['error', 'warning'].includes(m.type()) || /^\[(compositor|recorder)\]/.test(m.text())) && log(name, m.type(), m.text()));
    await page.addInitScript(fakeScreen);
    // FAIL_AUDIO=1: the director's capture recorder loses its audio encoder ~5 s
    // into the take; the room must switch to the backup recorder and keep audio.
    if (process.env.FAIL_AUDIO && i === 0) await page.addInitScript(() => localStorage.setItem('samurai:test:failAudioAfter', '500'));
    if (process.env.DIRECTOR_SCREEN && i === 0) await page.addInitScript(() => localStorage.setItem('samurai:test:stillScreen', '1'));
    await page.goto(i === 2 ? urlNoPw : url);
    if (i === 2) await page.getByLabel('Room password').fill(pw);
    if (i === 0) await page.screenshot({ path: 'test-results/lobby.png' });
    await page.getByLabel('Full name').fill(name);
    await page.getByLabel('Subtitle').fill(subtitle);
    await page.getByRole('button', { name: 'Join room' }).click();
    pages.push(page);
  }
  const [dir, sam, cam] = pages;

  log('waiting for the mesh');
  for (const p of pages) await p.waitForFunction(() => document.querySelectorAll('.strip .tile:not(.end-tile)').length === 3, null, { timeout: 60000 });
  log('all three see three tiles');
  log('waiting music chips with company:', await Promise.all(pages.map((p) => p.locator('.music-chip').count())));

  // Peer-to-peer audit: no TURN configured anywhere, every pair connected directly,
  // and nothing fetched from VDO.Ninja's TURN service.
  for (const [i, p] of pages.entries()) {
    const audit = await p.evaluate(async () => {
      const m = window.samurai.mesh;
      const pcs = [];
      for (const c of m.sdk.connections.values()) for (const d of ['publisher', 'viewer']) if (c[d]?.pc) pcs.push(['vdo-bootstrap', c[d].pc]);
      for (const l of m.links.values()) pcs.push(['own', l.pc]);
      const out = [];
      for (const [kind, pc] of pcs) {
        const turn = (pc.getConfiguration().iceServers || []).flatMap((s) => [].concat(s.urls)).filter((u) => /^turns?:/.test(u));
        let pair = null;
        const stats = await pc.getStats();
        const byId = new Map();
        stats.forEach((s) => byId.set(s.id, s));
        for (const s of byId.values())
          if (s.type === 'candidate-pair' && s.nominated && s.state === 'succeeded')
            pair = `${byId.get(s.localCandidateId)?.candidateType}->${byId.get(s.remoteCandidateId)?.candidateType}`;
        out.push(`${kind}: turn=${turn.length} route=${pair}`);
      }
      const turnFetches = performance.getEntriesByType('resource').filter((e) => /turnservers/.test(e.name)).length;
      return { pcs: out, turnFetches };
    });
    log(people[i][0], 'audit', JSON.stringify(audit));
  }

  // Director claims the chair from a right-click menu.
  // Before anyone directs, your own tile offers a one-click claim.
  await cam.waitForSelector('.tile:has-text("Cam Only") .claim');
  await cam.screenshot({ path: 'test-results/claim.png' });
  await dir.locator('.tile:has-text("Dana Director") .claim').click();
  await cam.waitForSelector('.claim', { state: 'detached' });
  const firstTile = (p) => p.evaluate(() => document.querySelector('.strip .tile .tile-name')?.textContent.replace(' (you)', ''));
  await cam.waitForFunction(() => document.querySelector('.strip .tile .tile-name')?.textContent.startsWith('Dana Director'));
  log('new director leads the strip:', await firstTile(cam));

  // Anyone can hand the chair to anyone from the right-click menu.
  await cam.locator('.tile', { hasText: 'Sam Screen' }).click({ button: 'right' });
  await cam.getByRole('button', { name: 'Make Sam Screen Shōgun (director)' }).click();
  await dir.waitForSelector('.tile:has-text("Sam Screen") .badge.crown');
  await cam.locator('.tile', { hasText: 'Dana Director' }).click({ button: 'right' });
  await cam.getByRole('button', { name: 'Make Dana Director Shōgun (director)' }).click();
  await sam.waitForSelector('.tile:has-text("Dana Director") .badge.crown');
  log('director handed around via the context menu; first tile now', await firstTile(sam));

  // Anyone can fix anyone's name.
  await cam.locator('.tile', { hasText: 'Sam Screen' }).click({ button: 'right' });
  await cam.getByRole('button', { name: "Edit Sam Screen's name" }).click();
  await cam.locator('.popover input').nth(1).fill('Presenter, renamed by Cam');
  await cam.getByRole('button', { name: 'Save' }).click();
  await sam.waitForFunction(() => window.samurai.profile.subtitle === 'Presenter, renamed by Cam', null, { timeout: 10000 });
  log('rename from another tile applied');

  // Drag the last tile to the front; the new order syncs to everyone.
  const names = (p) => p.evaluate(() => [...document.querySelectorAll('.strip .tile:not(.end-tile) .tile-name')].map((n) => n.textContent.replace(' (you)', '')));
  const before = await names(sam);
  const last = before[before.length - 1];
  await sam.locator('.strip .tile:not(.end-tile)').last().dragTo(sam.locator('.strip .tile').first());
  await dir.waitForFunction((n) => document.querySelector('.strip .tile .tile-name')?.textContent?.startsWith(n), last, { timeout: 10000 });
  log('order before', JSON.stringify(before), 'after (director view)', JSON.stringify(await names(dir)));
  log('reorder synced');

  // Edit your name from the pencil on your own tile (a popover, not a modal).
  await cam.locator('.tile:has-text("Cam Only") .tile-edit').click();
  await cam.locator('.popover input').nth(1).fill('Special Guest');
  await cam.getByRole('button', { name: 'Save' }).click();
  await cam.screenshot({ path: 'test-results/after-edit.png' });
  await sam.waitForSelector('.tile:has-text("Dana Director") .badge.crown');
  log('crown visible on other peers');

  await sam.getByRole('button', { name: 'Share screen' }).click();
  await dir.waitForSelector('.tile:has-text("Sam Screen") .badge[title="Screen share ready"]');

  if (process.env.STATS) {
    // Live meeting cost: what each person sends, with Sam's screen on stage.
    await dir.locator('.tile', { hasText: 'Sam Screen' }).click();
    await sleep(8000);
    const sample = (p) =>
      p.evaluate(async () => {
        const out = {};
        for (const l of window.samurai.mesh.links.values()) {
          (await l.pc.getStats()).forEach((s) => {
            if (s.type !== 'outbound-rtp') return;
            const k = `${s.kind}:${s.frameHeight ? s.frameHeight + 'p' : ''}${s.active === false ? ' (paused)' : ''}`;
            out[k] = (out[k] || 0) + s.bytesSent;
          });
        }
        return out;
      });
    for (const [i, p] of pages.entries()) {
      const a = await sample(p);
      await sleep(5000);
      const b = await sample(p);
      const kbps = Object.fromEntries(Object.keys(b).map((k) => [k, Math.round(((b[k] - (a[k] || 0)) * 8) / 5000)]));
      log(people[i][0], 'sends (kbps, summed over both peers):', JSON.stringify(kbps));
    }
    const rec = await dir.evaluate(() => ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus'].map((t) => `${t}: ${MediaRecorder.isTypeSupported(t)}`));
    log('recorder support', rec.join(' | '));
    await dir.locator('.tile', { hasText: 'Dana Director' }).click();
  }

  await sleep(2000); // let clocks settle
  // Record when each countdown number actually paints on a guest's screen.
  await cam.evaluate(() => {
    window.__count = [];
    let lastText = null;
    const tick = () => {
      const t = document.querySelector('.countdown span')?.textContent ?? null;
      if (t !== lastText) window.__count.push([t, Math.round(performance.now())]), (lastText = t);
      if (window.__count.length < 5) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await dir.getByRole('button', { name: 'Record' }).click();
  await cam.waitForSelector('.countdown span', { timeout: 10000 });
  log('countdown showing on a guest');
  await dir.waitForSelector('.rec-chip:has-text("REC")', { timeout: 10000 });
  log('recording');
  const marks = (await cam.evaluate(() => window.__count)).filter(([t]) => t !== null || true);
  log('countdown on a guest (label @ms since previous):', marks.map(([t, ms], i) => `${t ?? '–'}@${i ? ms - marks[i - 1][1] : 0}`).join(' '));

  // Non-directors can't switch the stage while recording.
  await cam.locator('.tile', { hasText: 'Sam Screen' }).click();
  await cam.waitForSelector('.toast');

  await sleep(4000); // director cam
  if (process.env.DIRECTOR_SCREEN) {
    // The director shares their own screen mid-take and flips the stage to it
    // with the Camera | Screen toggle, then back.
    await dir.getByRole('button', { name: 'Share screen' }).click();
    await dir.waitForSelector('.segmented');
    const t0 = Date.now();
    await dir.locator('.segmented button', { hasText: 'Screen' }).click();
    await dir.waitForSelector('.stage .pip');
    log('director screen on stage');
    await sleep(4000);
    await dir.locator('.segmented button', { hasText: 'Camera' }).click();
    log('director back to camera after', Date.now() - t0, 'ms');
    await sleep(1000);
  }
  await dir.locator('.tile', { hasText: 'Sam Screen' }).click(); // Sam's screen
  await sam.waitForFunction(() => !!document.querySelector('.stage .pip'), null, { timeout: 10000 });
  log('Sam screen on stage everywhere');
  await sleep(1500);
  // The director drags the camera overlay to the top-left corner.
  const pip = await dir.locator('.pip').boundingBox();
  const frame = await dir.locator('.stage-frame').boundingBox();
  await dir.mouse.move(pip.x + pip.width / 2, pip.y + pip.height / 2);
  await dir.mouse.down();
  await dir.mouse.move(frame.x + frame.width * 0.4, frame.y + frame.height * 0.4, { steps: 8 });
  await dir.screenshot({ path: 'test-results/pip-drag.png' });
  await dir.mouse.move(frame.x + pip.width, frame.y + pip.height, { steps: 8 });
  await dir.mouse.up();
  await sam.waitForSelector('.pip.c-tl', { timeout: 5000 });
  const cornerAt = Date.now();
  log('overlay moved to top-left (synced to a guest)');
  await sleep(1500);
  await dir.screenshot({ path: 'test-results/stage-director.png' });
  await sam.screenshot({ path: 'test-results/stage-guest.png' });
  await sleep(2500);
  await dir.locator('.tile', { hasText: 'Cam Only' }).click();
  // Cam Only turns their camera off for their whole segment.
  await cam.getByRole('button', { name: 'Turn camera off' }).click();
  await dir.waitForSelector('.stage .avatar', { timeout: 5000 });
  log('camera off shows initials on the stage');
  const camTracks = await cam.evaluate(() => window.samurai.getSnapshot().cam.getVideoTracks().map((t) => t.readyState));
  log('camera tracks while off (should be none, so the light is off):', JSON.stringify(camTracks));
  await sleep(3000);
  await cam.getByRole('button', { name: 'Turn camera on' }).click();
  // Mid-take device switch from the ⋯ menu: Camera › first listed device.
  await dir.getByRole('button', { name: 'More' }).click();
  await dir.locator('.has-sub', { hasText: 'Camera' }).hover();
  const devs = await dir.locator('.submenu [role=menuitemradio]').allTextContents();
  log('camera submenu lists:', JSON.stringify(devs));
  await dir.locator('.submenu [role=menuitemradio]').first().click();
  await sleep(500);
  await dir.locator('.tile.end-tile').click();
  await sleep(3000);
  await dir.getByRole('button', { name: 'Stop', exact: true }).click();
  log('stopped');
  if (process.env.RELOAD_DIRECTOR) {
    // The director drops out while guests upload, then comes back.
    await sleep(300);
    await dir.reload();
    log('director reloaded');
    await dir.waitForSelector('.tray', { timeout: 30000 }); // rejoins on its own
    log('director rejoined');
  }
  if (process.env.RELOAD_DURING_RENDER) {
    await dir.waitForSelector('text=Rendering the final cut', { timeout: 120000 });
    await dir.reload();
    log('director reloaded mid-render');
    await dir.waitForSelector('.tray', { timeout: 30000 });
    log('director back in the room');
  }

  for (const p of [sam, cam]) await p.waitForSelector('.safe', { timeout: 120000 });
  log('both guests told it is safe to close');
  await dir.waitForSelector('a:has-text("Download MP4")', { timeout: Number(process.env.RENDER_TIMEOUT || 600000) });
  log('render done');

  const b64 = await dir.evaluate(async () => {
    const href = document.querySelector('a[download]').href;
    const buf = new Uint8Array(await (await fetch(href)).arrayBuffer());
    let s = '';
    for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return btoa(s);
  });
  fs.mkdirSync('test-results', { recursive: true });
  fs.writeFileSync('test-results/final.mp4', Buffer.from(b64, 'base64'));
  log('saved test-results/final.mp4');
  await checkAlignment(dir);
  await checkOverlayAndCamOff(dir);
  if (process.env.FAIL_AUDIO || process.env.REPORT || process.env.DIRECTOR_SCREEN) {
    const dm = await dir.evaluate(() => window.samurai.dm);
    log('director report:\n  ' + dm.reports[dm.take.director].join('\n  '));
    if (process.env.DIRECTOR_SCREEN) {
      const ev = dm.stageLog.find((e) => e.stage.kind === 'peer' && e.stage.id === dm.take.director && e.stage.view === 'screen');
      const starts = Object.values(dm.files).map((f) => f.offset / 1000);
      const t0 = Math.min(3, Math.max(0, ...starts.filter((t) => t < 3)));
      for (const dt of [0.5, 2, 3.5]) {
        const T = ev.t / 1000 + dt - t0;
        const px = execFileSync('ffmpeg', ['-v', 'error', '-ss', String(T), '-i', 'test-results/final.mp4', '-frames:v', '1', '-vf', 'crop=10:10:100:900,scale=1:1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-']);
        log(`director screen segment +${dt}s: pixel rgb(${[...px].join(',')}) ->`, px[2] > 100 && px[1] < 80 ? 'STILL SCREEN' : 'not the screen');
      }
    }
    log('stage log:', JSON.stringify(dm.stageLog.map((e) => [Math.round(e.t), e.stage.kind === 'end' ? 'end' : dm.profiles[e.stage.id]?.name + ':' + e.stage.view])));
    log('director files:', Object.values(dm.files).filter((f) => f.peer === dm.take.director).map((f) => `${f.name} ${f.kind} ${f.timing} ${(f.size / 1e6).toFixed(1)}MB @${Math.round(f.offset)}ms`).join(' | '));
  }

  // Guests' OPFS should be empty of media now.
  for (const [i, p] of [sam, cam].entries()) {
    const left = await p.evaluate(async () => {
      const out = [];
      const root = await navigator.storage.getDirectory();
      const walk = async (d, pre) => {
        for await (const [n, h] of d.entries()) h.kind === 'directory' ? await walk(h, `${pre}${n}/`) : out.push(pre + n);
      };
      await walk(root, '');
      return out;
    });
    log(`guest ${i + 1} OPFS:`, left.join(', ') || '(empty)');
  }
  await dir.screenshot({ path: 'test-results/director.png' });
  await checkBackButton(browsers[2]);
  // Leave from the ⋯ menu goes back to the home screen.
  await cam.getByRole('button', { name: 'More' }).click();
  await cam.screenshot({ path: 'test-results/menu.png' });
  await cam.getByRole('button', { name: 'Leave room' }).click();
  await cam.waitForSelector('text=Create room');
  log('guest left and is on the home screen');
  await sam.screenshot({ path: 'test-results/guest.png' });
} catch (e) {
  log('FAILED', e.message);
  for (const [i, p] of pages.entries()) {
    await p.screenshot({ path: `test-results/fail-${i}.png` }).catch(() => {});
    const dump = await p
      .evaluate(() => {
        const r = window.samurai;
        const m = r.mesh;
        const snap = r.getSnapshot();
        return { me: r.me, render: snap.render, race: snap.race, dm: snap.directorTake && { announced: snap.directorTake.announced, expected: snap.directorTake.expected, rendered: snap.directorTake.rendered, files: Object.values(snap.directorTake.files).map((f) => `${f.name} ${f.kind} done=${f.done} ${f.received}/${f.size} @${Math.round(f.offset)}`), reports: snap.directorTake.reports }, myReport: snap.myReport, links: [...m.links.values()].filter((l) => !l.open).map((l) => [l.peer, l.pc.connectionState, l.pc.signalingState, l.trace.filter((x) => x !== 'tx cand via bootstrap').join(' | ')]) };
      })
      .catch((e) => e.message);
    console.log(`peer ${i}`, JSON.stringify(dump, null, 1));
  }
  process.exitCode = 1;
} finally {
  for (const b of browsers) await b.close();
  server.kill();
}

/** Reads the wall-clock barcode and the beeps back out of the final cut. */
async function checkAlignment(dir) {
  const dm = await dir.evaluate(() => window.samurai.dm);
  const starts = Object.values(dm.files).map((f) => f.offset / 1000);
  const t0 = Math.min(3, Math.max(0, ...starts.filter((t) => t < 3)));
  const wallAt = (T) => dm.take.startAt + (t0 + T) * 1000; // expected capture time of output time T
  const file = 'test-results/final.mp4';

  // Video: frames from the middle of the screen segment.
  // Sam's screen carries the barcode (the director's test screen, when shared, is a still image).
  const screenEv = dm.stageLog.find((e) => e.stage.kind === 'peer' && e.stage.view === 'screen' && dm.profiles[e.stage.id]?.name === 'Sam Screen');
  const errs = [];
  for (const dt of [1, 1.5, 2, 2.5]) {
    const T = screenEv.t / 1000 + dt - t0;
    const px = execFileSync('ffmpeg', ['-v', 'error', '-ss', String(T), '-i', file, '-frames:v', '1', '-vf', 'crop=1440:60:0:0,scale=24:1:flags=area', '-pix_fmt', 'gray', '-f', 'rawvideo', '-']);
    let v = 0;
    for (let b = 0; b < 24; b++) if (px[b] > 128) v |= 1 << b;
    const captured = v * 10;
    const expected = wallAt(T) % (0x1000000 * 10);
    errs.push(Math.round(captured - expected));
  }
  log('screen video alignment error (ms, + = late):', errs.join(', '));

  // Camera video: the director's camera opens the take (barcode shifted right by 240 px).
  const camErrs = [];
  for (const T of [0.5, 1, 1.5, 2]) {
    const px = execFileSync('ffmpeg', ['-v', 'error', '-ss', String(T), '-i', file, '-frames:v', '1', '-vf', 'crop=1440:60:240:0,scale=24:1:flags=area', '-pix_fmt', 'gray', '-f', 'rawvideo', '-']);
    let v = 0;
    for (let b = 0; b < 24; b++) if (px[b] > 128) v |= 1 << b;
    camErrs.push(Math.round(v * 10 - (wallAt(T) % (0x1000000 * 10))));
  }
  log('camera video alignment error (ms, + = late):', camErrs.join(', '));

  // Audio: onsets of the beeps.
  const pcm = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-ac', '1', '-ar', '8000', '-f', 's16le', '-'], { maxBuffer: 1 << 28 });
  const a = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.length / 2);
  const onsets = [];
  let quietFor = 8000;
  for (let i = 0; i < a.length; i++) {
    if (Math.abs(a[i]) > 3000) {
      if (quietFor > 2400) onsets.push(i / 8000);
      quietFor = 0;
    } else quietFor++;
  }
  const aerr = onsets.map((T) => {
    const w = wallAt(T);
    return Math.round(w - Math.round(w / 7000) * 7000);
  });
  log('audio beep alignment error (ms, + = late):', aerr.join(', ') || '(no beeps found)');
}

/** Reads pixels from the final cut: overlay corner during Sam's screen, initials while Cam Only's camera was off. */
async function checkOverlayAndCamOff(dir) {
  const dm = await dir.evaluate(() => window.samurai.dm);
  const starts = Object.values(dm.files).map((f) => f.offset / 1000);
  const t0 = Math.min(3, Math.max(0, ...starts.filter((t) => t < 3)));
  const px = (T, x, y) => [...execFileSync('ffmpeg', ['-v', 'error', '-ss', String(T), '-i', 'test-results/final.mp4', '-frames:v', '1', '-vf', `crop=8:8:${x}:${y},scale=1:1`, '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-'])];
  const isCam = ([r, g, b]) => Math.abs(r - 27) + Math.abs(g - 94) + Math.abs(b - 32) < 45; // the fake camera's #1b5e20
  const moved = dm.stageLog.find((e) => e.corner === 'tl');
  const samEnd = dm.stageLog.find((e) => e.t > moved.t && !(e.stage.kind === 'peer' && e.stage.view === 'screen'));
  const T = (samEnd.t / 1000 - 0.8) - t0; // late in Sam's segment, after the glide
  // Overlay box centres in 1920x1080: top-left (32+78, 32+97), bottom-right (1920-32-78, 1080-32-97)
  log('overlay corner check:', isCam(px(T, 106, 125)) ? 'camera at top-left' : 'NOT at top-left', '|', isCam(px(T, 1806, 947)) ? 'still at bottom-right' : 'bottom-right is screen');
  log('render report:\n  ' + (dm.reports.render ?? []).join('\n  '));
  const off = dm.camOff && Object.entries(dm.camOff).find(([, iv]) => iv.length);
  if (off) {
    const [peer, [[a]]] = off;
    const Tc = a / 1000 + 1.5 - t0;
    const c = px(Tc, 950, 530);
    log(`camera-off check (${dm.profiles[peer]?.name}): rgb(${c.join(',')}) ->`, isCam(c) ? 'camera still showing' : 'placeholder shown');
  } else log('camera-off check: no camera-off stretch recorded');
}

/** Browser Back from the lobby, and from a live call, must release camera and mic. */
async function checkBackButton(browser) {
  const page = await (await browser.newContext()).newPage();
  await page.addInitScript(() => {
    window.__tracks = [];
    const gum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (c) => {
      const s = await gum(c);
      window.__tracks.push(...s.getTracks());
      return s;
    };
  });
  const live = () => page.evaluate(() => window.__tracks.filter((t) => t.readyState === 'live').map((t) => t.kind));
  await page.goto(`http://localhost:${PORT}/`);
  await page.getByRole('button', { name: 'Create room' }).click();
  await page.getByLabel('Full name').fill('Back Button');
  await page.waitForFunction(() => window.__tracks.length > 0);
  await page.goBack();
  await page.waitForSelector('text=Create room');
  await sleep(300);
  log('back from the lobby, live tracks:', JSON.stringify(await live()));
  await page.getByRole('button', { name: 'Create room' }).click();
  await page.getByLabel('Full name').fill('Back Button');
  await page.getByRole('button', { name: 'Join room' }).click();
  await page.waitForSelector('.tray');
  await sleep(1000);
  await page.goBack();
  await page.waitForSelector('text=Create room');
  await sleep(500);
  log('back from a live call, live tracks:', JSON.stringify(await live()), '| home page shown');
  await page.close();
}
