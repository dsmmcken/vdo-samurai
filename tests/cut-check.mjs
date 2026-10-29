// Checks src/lib/cut.ts in a real browser: node tests/cut-check.mjs
// (runs a Vite dev server for the TypeScript; set CHROME like tests/e2e.mjs).
import { spawn } from 'node:child_process';
import os from 'node:os';
import { chromium } from 'playwright-core';

const PORT = Number(process.env.PORT || 4181);
const CHROME = process.env.CHROME || `${os.homedir()}/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome`;
const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
const browser = await chromium.launch({ executablePath: CHROME });
try {
  const page = await browser.newPage();
  for (let i = 0; ; i++) {
    try {
      await page.goto(`http://localhost:${PORT}/`);
      break;
    } catch (e) {
      if (i > 50) throw e;
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  const r = await page.evaluate(() => import('/tests/cut-check.ts').then((m) => m.run()));
  // Kept: 3–5 s, and 12.3–14 s from the keyframe at 12; everything else gone;
  // frames land at their own times with their own pictures; a gap holds the
  // last frame; audio (when there is some) is all there.
  let failed = 0;
  const check = (what, ok, got) => {
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${ok ? '' : `: ${JSON.stringify(got)}`}`);
    if (!ok) failed++;
  };
  for (const [name, c] of Object.entries(r)) {
    check(`${name}: cut matches the source (timestamps, keyframes)`, c.verify === 'ok', c.verify);
    check(`${name}: kept 3–4.97 s and 12–13.97 s`, JSON.stringify(c.runs) === '[[3,4.967],[12,13.967]]', c.runs);
    const inRange = c.frames.filter((f) => [3, 4.5, 12.5, 13.9].includes(f.t));
    check(`${name}: frames at their own times and pictures`, inRange.every((f) => f.got === f.t && f.rgb.every((v, i) => Math.abs(v - f.want[i]) <= 4)), inRange);
    check(`${name}: a gap holds the last kept frame`, c.frames.find((f) => f.t === 8)?.got === 4.967, c.frames.find((f) => f.t === 8));
    check(`${name}: the cut is smaller`, c.sizes.cut < c.sizes.original, c.sizes);
  }
  check('withAudio: all 20 s of audio', Math.abs(r.withAudio.audio.seconds - 20) < 0.1, r.withAudio.audio);
  process.exitCode = failed ? 1 : 0;
} finally {
  await browser.close();
  server.kill();
}
