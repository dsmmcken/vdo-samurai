// End-to-end: three headless Chromium peers meet through wss.vdo.ninja, record a
// short take with stage switches, upload to the director, and render the cut.
// Usage: npm run build && node tests/e2e.mjs   (writes test-results/final.mp4)
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { flight, FLIGHT_MS } from '../src/lib/reactions.ts';
import { inkColor } from '../src/lib/ink.ts';

const PORT = Number(process.env.PORT || 4179); // PORT=...: another one, when 4179 is busy
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
      // (starts at x=360: clear of the camera overlay in any top corner)
      const v = Math.floor(Date.now() / 10) & 0xffffff;
      for (let b = 0; b < 24; b++) {
        g.fillStyle = (v >> b) & 1 ? '#fff' : '#000';
        g.fillRect(360 + b * 50, 0, 50, 60);
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
let invite = null; // the third person opens the director's invite link and types the password
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
    // A guest's upload goes silent partway (channel open, no error); the director must notice and ask again.
    if (process.env.FREEZE_UPLOAD && i === 1) await page.addInitScript(() => localStorage.setItem('samurai:test:freezeUploadAt', '1000000'));
    // KEEP_UNCUT=1: Sam keeps a copy of each recording before trimming it (saved to test-results/uncut/).
    if (process.env.KEEP_UNCUT && i === 1) await page.addInitScript(() => localStorage.setItem('samurai:test:keepUncut', '1'));
    if (process.env.DIRECTOR_SCREEN && i === 0) await page.addInitScript(() => localStorage.setItem('samurai:test:stillScreen', '1'));
    await page.goto(i === 2 ? invite : url);
    if (i === 0) {
      await page.screenshot({ path: 'test-results/lobby.png' });
      invite = await page.locator('.invite code').textContent();
      log('invite carries a password check, not the password:', /[#&]hash=[0-9a-f]{6}(&|$)/.test(invite) && !invite.includes(pw));
    }
    if (i === 2) {
      // A wrong password is caught in the lobby instead of joining a different room.
      await page.getByLabel('Room password').fill(`${pw}x`);
      await page.getByRole('button', { name: 'Join room' }).click();
      log('wrong password refused:', await page.getByText("That's not this room's password").waitFor({ timeout: 5000 }).then(() => true, () => false), 'still in lobby:', (await page.locator('.lobby').count()) === 1);
      await page.getByLabel('Room password').fill(pw);
      log('error clears on edit, no "correct" hint:', (await page.locator('.field small.error').count()) === 0);
    }
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
  // Before anyone directs, the stage offers a one-click claim.
  await cam.waitForSelector('.director-call .claim');
  await cam.screenshot({ path: 'test-results/claim.png' });
  await dir.getByRole('button', { name: 'Become Shōgun', exact: true }).click();
  await cam.waitForSelector('.director-call', { state: 'detached' });
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

  // Ink works on a camera too, not just a shared screen: a guest draws across
  // the director's camera (it's in the final cut too: checkInk).
  await sleep(1500); // director cam
  await cam.getByRole('button', { name: 'Draw on the stage' }).click();
  const camInkColour = inkColor(await cam.evaluate(() => ({ by: window.samurai.me, c: window.samurai.inkSlot })));
  const fr = await cam.locator('.stage-frame').boundingBox();
  await cam.mouse.move(fr.x + fr.width * 0.35, fr.y + fr.height * 0.55);
  await cam.mouse.down();
  await cam.mouse.move(fr.x + fr.width * 0.65, fr.y + fr.height * 0.55, { steps: 15 });
  await cam.mouse.up();
  await cam.keyboard.press('Escape');
  await dir.waitForFunction(() => [...window.samurai.ink.values()].some((s) => s.up !== undefined && s.pts.length > 5), null, { timeout: 5000 });
  log("ink on the director's camera reached the director");
  await sleep(2500);
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
  // Sam's screen is encoded once and sent to both viewers over data channels,
  // at full size, with no WebRTC screen track.
  for (const p of [dir, cam]) await p.waitForFunction(() => [...window.samurai.views.values()].some((v) => v.frames >= 5), null, { timeout: 10000 });
  const shown = await dir.evaluate(() => {
    const v = document.querySelector('.stage-video');
    return { w: v.videoWidth, h: v.videoHeight, frames: [...window.samurai.views.values()].map((x) => x.frames) };
  });
  const cast = await sam.evaluate(() => ({ kb: Math.round((window.samurai.caster?.sent ?? 0) / 1024), tracks: [...window.samurai.mesh.links.values()].map((l) => l.pc.getSenders().filter((s) => s.track?.kind === 'video').length) }));
  log('screen arrives encoded once:', JSON.stringify(shown), 'Sam sent', cast.kb, 'KB per viewer; video senders per link', JSON.stringify(cast.tracks));
  if (shown.w !== 1920 || shown.h !== 1080) throw new Error(`screen on stage is ${shown.w}x${shown.h}, expected 1920x1080`);
  // A guest picks up the pen and draws across Sam's screen: it reaches everyone,
  // the director logs it, it fades, and the final cut has it (checkInk).
  await cam.getByRole('button', { name: 'Draw on the stage' }).click();
  const inkColour = inkColor(await cam.evaluate(() => ({ by: window.samurai.me, c: window.samurai.inkSlot })));
  // Three people in the room, three different ink colours.
  const slots = await Promise.all(pages.map((p) => p.evaluate(() => window.samurai.inkSlot)));
  log('ink colour slots:', JSON.stringify(slots));
  if (new Set(slots).size !== slots.length) throw new Error(`two people share an ink colour: ${slots}`);
  const sv = await cam.locator('.stage-video').boundingBox();
  await cam.mouse.move(sv.x + sv.width * 0.35, sv.y + sv.height * 0.35);
  await cam.mouse.down();
  await cam.mouse.move(sv.x + sv.width * 0.65, sv.y + sv.height * 0.35, { steps: 15 });
  await cam.mouse.up();
  await cam.keyboard.press('Escape');
  const lifted = Date.now();
  const inked = () => [...window.samurai.ink.values()].some((s) => s.up !== undefined && s.pts.length > 5);
  for (const p of [dir, sam]) await p.waitForFunction(inked, null, { timeout: 5000 });
  const logged = await dir.evaluate(() => Object.values(window.samurai.inkLog).map((s) => `${s.pts.length} points, ${Math.round(s.up - s.pts[0][2])} ms`));
  log(`ink (${inkColour}) reached the director and Sam; director logged:`, JSON.stringify(logged));
  await sam.waitForFunction(() => window.samurai.ink.size === 0, null, { timeout: 8000 });
  log(`ink faded on Sam's stage ${((Date.now() - lifted) / 1000).toFixed(1)} s after the pen lifted`);
  await sleep(1500);
  await react(cam, [dir, sam]);
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
  // ...and becomes a circle, from the hover menu.
  const face = await dir.locator('.pip-face').boundingBox();
  await sleep(600);
  await dir.mouse.move(face.x + face.width / 2, face.y + face.height / 2);
  await dir.getByRole('button', { name: 'Circle overlay' }).click();
  await sam.waitForSelector('.pip.s-circle', { timeout: 5000 });
  log('overlay is a circle for a guest too');
  // Hide it, then bring it back via a different corner (top-right).
  await sleep(1200);
  const face2 = await dir.locator('.pip-face').boundingBox();
  await dir.mouse.move(face2.x + face2.width / 2, face2.y + face2.height / 2);
  await dir.getByRole('button', { name: 'Hide camera overlay' }).click();
  await sam.waitForSelector('.pip.hidden', { timeout: 5000 });
  await sleep(1500);
  const spotTr = await dir.locator('.pip-spot.c-tr').boundingBox();
  await dir.mouse.move(spotTr.x + spotTr.width / 2, spotTr.y + spotTr.height / 2);
  await dir.getByRole('button', { name: 'Show camera overlay top right' }).click();
  await sam.waitForSelector('.pip.c-tr:not(.hidden)', { timeout: 5000 });
  log('overlay hidden, then shown again at top-right (synced)');
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
  // Cam Only goes camera-off for the end screen: it should show only the other two.
  await cam.getByRole('button', { name: 'Turn camera off' }).click();
  await dir.locator('.tile.end-tile').click();
  await dir.waitForFunction(() => document.querySelectorAll('.end-cell').length === 2, null, { timeout: 5000 });
  log('live end screen leaves out the camera-off person: 2 cells');
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
  // The transfer log: the director's own lines plus each guest's, forwarded.
  await dir.waitForTimeout(2500); // guests forward every 2 s
  const xlogs = await dir.evaluate(() => window.samurai.getSnapshot().transferLogs.map((l) => ({ who: l.who, n: l.lines.length, key: l.lines.filter((x) => /saved|finished|FAILED|STALLED|messages|queued [0-9]|not yet on disk|channel open|cut to the edit|trim to the edit|never on stage|the last \d+ s|channel (out|in) \+/.test(x)) })));
  log('transfer logs on the director:', xlogs.map((l) => `${l.who}: ${l.n} lines`).join(', '));
  for (const l of xlogs) for (const k of l.key) log(`  [${l.who}] ${k}`);
  await dir.locator('.after').screenshot({ path: 'test-results/after-panel.png' });
  await dir.locator('.after .text-link, .after .problems').first().click(); // 'Transfer log' in the header, or 'N problems · Details'
  log('details modal shows transfer sections:', await dir.locator('.details h3', { hasText: 'Transfers' }).count());
  await dir.keyboard.press('Escape');
  await dir.locator('.modal-backdrop').click({ position: { x: 5, y: 5 } }).catch(() => {});
  // The panel can't be closed while it's the only sign of progress: never on
  // the director's; a guest's leaves by itself (out to the right, with a puff)
  // once everyone's upload is in.
  log('director panel has no close button:', (await dir.locator('.after [aria-label="Close"]').count()) === 0);
  await sam.waitForSelector('.after.leaving', { timeout: 10000 });
  await sam.waitForTimeout(350);
  await sam.screenshot({ path: 'test-results/after-leaving.png', clip: { x: 760, y: 0, width: 520, height: 260 } });
  await sam.waitForSelector('.after', { state: 'detached', timeout: 5000 });
  log('guest panel left by itself once everyone was done');
  if (process.env.KEEP_UNCUT) {
    const copies = await sam.evaluate(async () => {
      const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('test-copies');
      const out = [];
      for await (const [name, h] of dir.entries()) {
        const buf = new Uint8Array(await (await h.getFile()).arrayBuffer());
        let s = '';
        for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
        out.push([name, btoa(s)]);
      }
      return out;
    });
    fs.mkdirSync('test-results/uncut', { recursive: true });
    for (const [name, b64] of copies) fs.writeFileSync(`test-results/uncut/${name}`, Buffer.from(b64, 'base64'));
    log('kept uncut recordings:', copies.map(([n]) => n).join(', '));
  }
  // A request for a file the guest no longer has (say, trimmed and renamed)
  // gets their current files offered again, and the director stops waiting on
  // anything of theirs that isn't in the offer.
  {
    const samId = await sam.evaluate(() => window.samurai.me);
    const takeId = await dir.evaluate(() => window.samurai.dm.take.id);
    await dir.evaluate(({ samId, takeId }) => {
      const r = window.samurai;
      r.dm.files['stale-original.mp4'] = { name: 'stale-original.mp4', peer: samId, kind: 'cam', offset: 0, size: 1000, mime: 'video/mp4', received: 0, done: false };
      r.mesh.links.get(samId).send({ t: 'want', takeId, name: 'stale-original.mp4', offset: 0 });
    }, { samId, takeId });
    await dir.waitForFunction(() => !window.samurai.dm.files['stale-original.mp4'], null, { timeout: 15000 }).catch(() => {});
    const samSaid = await sam.evaluate(() => window.samurai.xlog.lines.filter((l) => /stale-original/.test(l)).map((l) => l.slice(13)));
    const dirSaid = await dir.evaluate(() => window.samurai.xlog.lines.filter((l) => /stale-original/.test(l)).map((l) => l.slice(13)));
    log('unknown file asked for; guest:', JSON.stringify(samSaid), '| director:', JSON.stringify(dirSaid), '| dropped:', await dir.evaluate(() => !window.samurai.dm.files['stale-original.mp4']));
  }
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
  // YouTube's upload spec wants the index (moov) before the media (mdat): "fast start".
  {
    const mp4 = fs.readFileSync('test-results/final.mp4');
    const boxes = [];
    for (let at = 0; at + 8 <= mp4.length && boxes.length < 8; ) {
      let size = mp4.readUInt32BE(at);
      boxes.push(mp4.toString('latin1', at + 4, at + 8));
      if (size === 1) size = Number(mp4.readBigUInt64BE(at + 8));
      if (size < 8) break;
      at += size;
    }
    log('top-level boxes:', boxes.join(' '), '| moov before mdat:', boxes.indexOf('moov') >= 0 && boxes.indexOf('moov') < boxes.indexOf('mdat'));
    log('streams:', execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,profile,bit_rate,sample_rate,channels', '-of', 'compact=p=0', 'test-results/final.mp4']).toString().trim().replace(/\n/g, ' | '));
  }
  // Downloaded: the panel goes; Recording details keeps a download until the next take.
  await dir.getByRole('link', { name: /Download MP4/ }).click();
  await dir.waitForSelector('.after', { state: 'detached', timeout: 5000 });
  await dir.getByRole('button', { name: 'More' }).click();
  await dir.getByRole('button', { name: 'Recording details' }).click();
  log('after download the panel left; details offer:', await dir.locator('.final-cut').textContent());
  await dir.screenshot({ path: 'test-results/details-final-cut.png', clip: { x: 300, y: 60, width: 680, height: 220 } });
  await dir.getByRole('button', { name: 'Close' }).click();
  await checkAlignment(dir);
  await checkOverlayAndCamOff(dir);
  await checkReaction(dir);
  await checkReactionNames(cam, dir);
  await checkInk(dir, camInkColour, 0, "on the director's camera");
  await checkInk(dir, inkColour, 1, "on Sam's screen");
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
  log('menu has Copy password:', (await cam.getByRole('button', { name: 'Copy password' }).count()) === 1);
  await cam.screenshot({ path: 'test-results/menu.png' });
  await cam.getByRole('button', { name: 'Leave room' }).click();
  await cam.waitForSelector('text=Create or join room');
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
    const px = execFileSync('ffmpeg', ['-v', 'error', '-ss', String(T), '-i', file, '-frames:v', '1', '-vf', 'crop=1200:60:360:0,scale=24:1:flags=area', '-pix_fmt', 'gray', '-f', 'rawvideo', '-']);
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
  const moved = dm.stageLog.find((e) => e.corner === 'tr' && e.t > (dm.stageLog.find((x) => x.corner === 'tl')?.t ?? 0));
  const samEnd = dm.stageLog.find((e) => e.t > moved.t && !(e.stage.kind === 'peer' && e.stage.view === 'screen'));
  const T = (samEnd.t / 1000 - 0.8) - t0; // late in Sam's segment, after the glide
  // Overlay box centres in 1920x1080: top-left (32+78, 32+97), bottom-right (1920-32-78, 1080-32-97)
  // Circle at top-left: (40,40) is inside its bounding box but outside the circle.
  log('overlay shape check (top-right):', isCam(px(T, 1792, 120)) ? 'camera at circle centre' : 'NO camera at centre', '|', isCam(px(T, 1884, 36)) ? 'camera in box corner (not a circle)' : 'screen in box corner (circle)');
  // Transitions, frame by frame (render geometry: circle 184 @32px inset; rect 156x195).
  const dist = (c) => Math.abs(c[0] - 27) + Math.abs(c[1] - 94) + Math.abs(c[2] - 32); // 0 = camera colour
  const circleEv = dm.stageLog.find((e) => e.pip?.shape === 'circle');
  const hideEv = dm.stageLog.find((e) => e.pip?.hidden);
  const showEv = dm.stageLog.find((e) => hideEv && e.t > hideEv.t && e.pip && !e.pip.hidden);
  const at = (ev, dt) => ev.t / 1000 + dt - t0;
  // Inside the rectangle, outside the circle: camera -> screen while it morphs.
  log('shape morph at (40,186): ' + [0.02, 0.15, 0.3, 0.6].map((dt) => `+${dt}s ${dist(px(at(circleEv, dt), 40, 186))}`).join(', ') + '  (0 = camera, large = screen)');
  // Circle centre while hiding: camera, then blended, then gone.
  log('hide fade at circle centre: ' + [0.02, 0.15, 0.3, 0.6].map((dt) => `+${dt}s ${dist(px(at(hideEv, dt), 120, 120))}`).join(', '));
  // Shown again at top-right: circle centre there is camera once it's grown in.
  log('reappear at top-right centre (1796,124): ' + [0.02, 0.6].map((dt) => `+${dt}s ${dist(px(at(showEv, dt), 1792, 120))}`).join(', '));
  log('overlay corner check:', isCam(px(T, 1792, 120)) ? 'camera at top-right' : 'NOT at top-right', '|', isCam(px(T, 1806, 947)) ? 'still at bottom-right' : 'bottom-right is screen');
  log('render report:\n  ' + (dm.reports.render ?? []).join('\n  '));
  const off = dm.camOff && Object.entries(dm.camOff).find(([, iv]) => iv.length);
  if (off) {
    const [peer, [[a]]] = off;
    const Tc = a / 1000 + 1.5 - t0;
    const c = px(Tc, 950, 530);
    log(`camera-off check (${dm.profiles[peer]?.name}): rgb(${c.join(',')}) ->`, isCam(c) ? 'camera still showing' : 'placeholder shown');
  } else log('camera-off check: no camera-off stretch recorded');
  // End screen with one camera off: two cells, so the middle of the frame is the gap between them.
  const dur = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', 'test-results/final.mp4']).toString());
  const mid = px(dur - 0.5, 956, 536);
  log(`end screen centre pixel rgb(${mid.join(',')}) ->`, isCam(mid) ? 'a camera (3 cells?)' : 'gap between 2 cells');
}

/** The guest's stroke in the final cut: there just after the pen lifted, gone once it has faded. */
/** The `which`-th stroke of the take (in time order) is in the final cut, then fades. */
async function checkInk(dir, colour, which, where) {
  const { dm, ink } = await dir.evaluate(() => ({ dm: window.samurai.dm, ink: Object.values(window.samurai.inkLog).sort((a, b) => a.pts[0][2] - b.pts[0][2]) }));
  const starts = Object.values(dm.files).map((f) => f.offset / 1000);
  const t0 = Math.min(3, Math.max(0, ...starts.filter((t) => t < 3)));
  const s = ink[which];
  if (!s) throw new Error(`no ink ${where} in the director log`);
  const [x, y] = s.pts[Math.floor(s.pts.length / 2)];
  const px = (T) => [...execFileSync('ffmpeg', ['-v', 'error', '-ss', String(T), '-i', 'test-results/final.mp4', '-frames:v', '1', '-vf', `crop=2:2:${Math.round(x * 1920) - 1}:${Math.round(y * 1080) - 1},scale=1:1`, '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-'])];
  const want = [1, 3, 5].map((i) => parseInt(colour.slice(i, i + 2), 16));
  const isInk = (c) => c.reduce((a, v, i) => a + Math.abs(v - want[i]), 0) < 90;
  const solid = px(s.up / 1000 + 0.5 - t0);
  const gone = px(s.up / 1000 + 3.5 - t0);
  log(`ink ${where} in the final cut at (${Math.round(x * 1920)},${Math.round(y * 1080)}): +0.5 s rgb(${solid.join(',')}) ${isInk(solid) ? 'INK' : 'no ink'}, +3.5 s rgb(${gone.join(',')}) ${isInk(gone) ? 'INK' : 'faded'}`);
  if (!isInk(solid) || isInk(gone)) throw new Error(`ink ${where} missing from the final cut, or not faded`);
}

/** Names of the scripts, wasm and stylesheets a page has fetched that belong to reactions. */
function reactionLoads(p) {
  return p.evaluate(() =>
    performance
      .getEntriesByType('resource')
      .map((e) => e.name)
      .filter((n) => /ReactionPicker|lottie-|dotlottie-player|Noto\+Color\+Emoji/.test(n))
      .map((n) => n.replace(/^.*\/(assets\/)?/, '').replace(/-[\w]{8}\.(js|wasm)$/, '.$1').slice(0, 40)),
  );
}

/**
 * A guest opens the picker, searches and sends a reaction: it floats up on
 * every stage (drawn by the player, which only now loads), and the director
 * logs it and keeps its animation for the render.
 */
async function react(guest, others) {
  log('reaction files loaded before anyone reacts:', JSON.stringify(await Promise.all(pages.map(reactionLoads))));
  await guest.getByRole('button', { name: 'Emoji reaction' }).click();
  // The picker takes over from its loading stand-in first (an atomic fill can
  // straddle that swap; typed keys can't, PickerShell hands them over).
  await guest.locator('.picker:not(.loading) .picker-cells button').first().waitFor();
  await guest.getByLabel('Search reactions').fill('congrats');
  const top = await guest.locator('.picker-cells button').evaluateAll((b) => b.slice(0, 5).map((x) => x.textContent).join(' '));
  await guest.screenshot({ path: 'test-results/picker.png' });
  await guest.getByLabel('Search reactions').press('Enter');
  await guest.keyboard.press('Escape');
  const sent = Date.now();
  const me = await guest.evaluate(() => window.samurai.me);
  const got = (id) => [...window.samurai.reactions.values()].some((r) => r.by === id);
  await guest.waitForFunction(got, me, { timeout: 5000 }).catch(() => {
    throw new Error(`the guest's reaction never started on its own stage (picker shows: ${top || 'nothing'})`);
  });
  for (const p of others) await p.waitForFunction(got, me, { timeout: 5000 });
  log(`reaction sent (search "congrats" top 5: ${top}); reached the director and Sam after ${Date.now() - sent} ms`);
  // Drawn on every stage: some non-transparent pixels on the reactions canvas.
  const drawn = () => {
    const c = document.querySelector('canvas.reactions');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 128) n++;
    return n > 500 && n;
  };
  for (const [i, p] of [guest, ...others].entries()) {
    const px = await (await p.waitForFunction(drawn, null, { timeout: 8000 })).jsonValue();
    log(`  ${['guest (sender)', 'director', 'Sam'][i]}: animated emoji on stage, ${px} px, ${Date.now() - sent} ms after sending`);
  }
  await others[0].screenshot({ path: 'test-results/reaction.png' });
  log('reaction files loaded now:', JSON.stringify(await Promise.all(pages.map(reactionLoads))));
  const logged = await pages[0].evaluate(() => window.samurai.reactLog.map((r) => `${r.cp} at ${r.at} ms`));
  log('director logged reactions:', JSON.stringify(logged));
  if (logged.length !== 1) throw new Error('the director should have logged one reaction');
  await sleep(3000); // let it land
}

/** A name under the first of each emoji someone sends; the same emoji again within 5 s goes unnamed. */
async function checkReactionNames(guest, dir) {
  const me = await guest.evaluate(() => window.samurai.me);
  for (const cp of ['1f431', '1f431', '1f389']) {
    await guest.evaluate((cp) => window.samurai.react(cp), cp);
    await sleep(150);
  }
  await dir.waitForFunction((id) => [...window.samurai.reactions.values()].filter((r) => r.by === id).length === 3, me, { timeout: 5000 });
  const named = await dir.evaluate((id) => [...window.samurai.reactions.values()].filter((r) => r.by === id).sort((a, b) => a.at - b.at).map((r) => `${r.cp}:${r.named ? 'named' : 'plain'}`), me);
  log('reaction names (cat, cat, party):', named.join(' '), named.join(' ') === '1f431:named 1f431:plain 1f389:named' ? 'OK' : 'WRONG');
  await sleep(900);
  await dir.screenshot({ path: 'test-results/reaction-names.png' });
  await sleep(3500);
}

/** The reaction in the final cut: a busy patch of emoji along its flight path, flat screen there once it has landed. */
async function checkReaction(dir) {
  const { dm, r, files } = await dir.evaluate(async () => {
    const dm = window.samurai.dm;
    const d = await (await (await navigator.storage.getDirectory()).getDirectoryHandle('takes')).getDirectoryHandle(dm.take.id);
    const files = [];
    for await (const [n] of d.entries()) if (/^(reactions|lottie-)/.test(n)) files.push(n);
    return { dm, r: window.samurai.reactLog[0], files };
  });
  log('director OPFS keeps:', files.join(', '));
  if (!files.includes(`lottie-${r.cp}.json`)) throw new Error("the reaction's animation wasn't saved with the take");
  const starts = Object.values(dm.files).map((f) => f.offset / 1000);
  const t0 = Math.min(3, Math.max(0, ...starts.filter((t) => t < 3)));
  // Spread of brightness over the emoji's square: the screen there is one flat colour.
  const spread = (ms, box) => {
    const T = ms / 1000 - t0;
    const raw = execFileSync('ffmpeg', ['-v', 'error', '-ss', String(T), '-i', 'test-results/final.mp4', '-frames:v', '1', '-vf', `crop=${box.s}:${box.s}:${box.x}:${box.y}`, '-pix_fmt', 'gray', '-f', 'rawvideo', '-']);
    const mean = raw.reduce((a, v) => a + v, 0) / raw.length;
    return Math.round(Math.sqrt(raw.reduce((a, v) => a + (v - mean) ** 2, 0) / raw.length));
  };
  // Three points on its path clear of the test screen's text and barcode, the
  // lower third and the camera overlay; the same squares once it has landed.
  const clear = (b) => b.y > 80 && !(b.y + b.s > 360 && b.y < 620 && b.x < 1150) && !(b.x < 520 && b.y + b.s > 850) && !(b.x + b.s > 1650 && b.y + b.s > 800);
  const out = [];
  for (let dt = 300; dt < 2600 && out.length < 3; dt += 100) {
    const f = flight(r, r.at + dt);
    const s = Math.round(f.size * 1080 * 0.6);
    const box = { s, x: Math.round(f.x * 1920 - s / 2), y: Math.round(f.y * 1080 - s / 2) };
    if (clear(box) && !out.some(([, b]) => Math.abs(b.y - box.y) < s)) out.push([dt, box, spread(r.at + dt, box), spread(r.at + FLIGHT_MS + 300, box)]);
  }
  log('reaction in the final cut (brightness spread over its path, then after it landed):', out.map(([dt, b, a, z]) => `+${dt} ms at (${b.x},${b.y}): ${a} -> ${z}`).join(' | '));
  if (!out.length || !out.every(([, , a, z]) => a > 15 && z < 8)) throw new Error('reaction missing from the final cut');
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
  await page.getByRole('button', { name: 'Create or join room' }).click();
  await page.getByLabel('Full name').fill('Back Button');
  await page.waitForFunction(() => window.__tracks.length > 0);
  await page.goBack();
  await page.waitForSelector('text=Create or join room');
  await sleep(300);
  log('back from the lobby, live tracks:', JSON.stringify(await live()));
  await page.getByRole('button', { name: 'Create or join room' }).click();
  await page.getByLabel('Full name').fill('Back Button');
  await page.getByRole('button', { name: 'Join room' }).click();
  await page.waitForSelector('.tray');
  await sleep(1000);
  await page.goBack();
  await page.waitForSelector('text=Create or join room');
  await sleep(500);
  log('back from a live call, live tracks:', JSON.stringify(await live()), '| home page shown');
  await page.close();
}
