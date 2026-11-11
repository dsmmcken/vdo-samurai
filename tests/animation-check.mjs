// Checks animations (src/lib/animation-*.ts) in a real browser: node tests/animation-check.mjs
// The library's merge rules, the strip, and the sandbox. Runs a Vite dev server
// for the TypeScript; set CHROME like tests/e2e.mjs.
import { spawn } from 'node:child_process';
import os from 'node:os';
import { chromium } from 'playwright-core';

const PORT = Number(process.env.PORT || 4182);
const CHROME = process.env.CHROME || `${os.homedir()}/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome`;
const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
const browser = await chromium.launch({ executablePath: CHROME });
let failed = 0;
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
  const results = await page.evaluate(() => import('/tests/animation-check.ts').then((m) => m.run()));
  for (const [what, ok, got] of results) {
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${ok ? '' : `: ${JSON.stringify(got)}`}`);
    if (!ok) failed++;
  }
} finally {
  await browser.close();
  server.kill();
}
console.log(failed ? `${failed} failed` : 'all ok');
process.exit(failed ? 1 : 0);
