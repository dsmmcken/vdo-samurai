// Serves this folder and runs a page in headless Chromium, printing window.result.
// Usage: CHROME=/path/to/chrome node run-headless.mjs compare.html
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { serve } from './serve.mjs';

const root = path.dirname(new URL(import.meta.url).pathname);
const srv = serve(8098);
const browser = await chromium.launch({ executablePath: process.env.CHROME });
const page = await browser.newPage();
page.on('pageerror', async (e) => {
  console.error('page error:', e.message);
  process.exit(1);
});
await page.goto(`http://localhost:8098/${process.argv[2] ?? 'compare.html'}`);
await page.waitForFunction(() => window.result, null, { timeout: 300000 });
const result = await page.evaluate(() => window.result);
if (result.sheet) {
  fs.mkdirSync(path.join(root, 'results'), { recursive: true });
  fs.writeFileSync(path.join(root, 'results', 'sheet.jpg'), Buffer.from(result.sheet, 'base64'));
  console.log(result.text + '\ncontact sheet: results/sheet.jpg');
} else console.log(typeof result === 'string' ? result : JSON.stringify(result, null, 1));
await browser.close();
srv.close();
