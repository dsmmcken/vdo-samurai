// Runs the bench page in headless Chromium (software codecs only in this sandbox).
// Usage: node run-headless.mjs [mode] [clips] [seconds]   — needs server.mjs running.
import { chromium } from 'playwright-core';
import os from 'node:os';
import fs from 'node:fs';

const [mode = 'composite', clips = '8', seconds = '15'] = process.argv.slice(2);
const browser = await chromium.launch({
  executablePath: `${os.homedir()}/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome`,
});
const page = await browser.newPage();
page.on('console', (m) => m.text().startsWith('[bench]') && console.log(m.text().slice(8)));
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.goto(`http://localhost:${process.env.PORT || 8080}/?auto=1&mode=${mode}&clips=${clips}&seconds=${seconds}&hw=prefer-software`);
await page.waitForFunction(() => /Done|Failed/.test(document.getElementById('status').textContent), null, { timeout: 0, polling: 1000 });
console.log('status:', await page.textContent('#status'));
if (mode === 'composite') {
  // Pull the finished MP4 out of the page so it can be checked with ffprobe.
  const b64 = await page.evaluate(async () => {
    const href = document.getElementById('download').href;
    if (!href) return null;
    const buf = new Uint8Array(await (await fetch(href)).arrayBuffer());
    let s = '';
    for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return btoa(s);
  });
  if (b64) {
    fs.mkdirSync('results', { recursive: true });
    fs.writeFileSync('results/headless-composite.mp4', Buffer.from(b64, 'base64'));
    console.log('saved results/headless-composite.mp4');
  }
}
await browser.close();
