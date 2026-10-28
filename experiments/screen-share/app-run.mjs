// Runs app.html (the app's own screencast code) in headless Chromium against
// the app's running vite dev server. Usage: CHROME=/path/to/chrome node app-run.mjs
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: process.env.CHROME });
const page = await browser.newPage();
page.on('pageerror', (e) => console.error('page error:', e.message));
page.on('console', (m) => m.type() !== 'log' && console.error(m.text()));
await page.goto(`http://localhost:${process.env.PORT ?? 8080}/experiments/screen-share/app.html`);
await page.waitForFunction(() => window.result, null, { timeout: 120000 });
const r = await page.evaluate(() => window.result);
console.table(r.rows);
console.log('viewer frames shown:', r.viewerFrames);
await browser.close();
