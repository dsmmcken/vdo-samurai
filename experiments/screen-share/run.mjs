// Serves this folder and runs bench.html in headless Chromium, printing a table.
// Usage: CHROME=/path/to/chrome node run.mjs [only]    (PAGE=webcodecs.html for the WebCodecs bench)
import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const root = path.dirname(new URL(import.meta.url).pathname);
const srv = http.createServer((q, s) => {
  const f = path.join(root, decodeURIComponent(q.url.split('?')[0]));
  if (!f.startsWith(root) || !fs.existsSync(f)) return s.writeHead(404).end();
  s.writeHead(200, { 'content-type': f.endsWith('.js') ? 'text/javascript' : 'text/html' });
  fs.createReadStream(f).pipe(s);
}).listen(8099);
const browser = await chromium.launch({ executablePath: process.env.CHROME });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
page.on('crash', () => console.error('renderer crashed'));
page.on('pageerror', (e) => console.error('page error:', e.message));
page.on('console', (m) => (m.type() === 'error' || process.env.VERBOSE) && console.error(m.text()));
const PAGE = process.env.PAGE ?? 'bench.html';
await page.goto(`http://localhost:8099/${PAGE}${process.argv[2] ? '?only=' + encodeURIComponent(process.argv[2]) : ''}`);
await page.waitForFunction(() => window.result, null, { timeout: 900000 });
const result = await page.evaluate(() => window.result);
const rows = result.rows ?? result;
// Close-ups (WebCodecs bench): results/crop-<name>.png, plus the original.
fs.mkdirSync(path.join(root, 'results'), { recursive: true });
const png = (name, url) => fs.writeFileSync(path.join(root, 'results', `crop-${name.replace(/[^a-z0-9]+/gi, '-')}.png`), Buffer.from(url.split(',')[1], 'base64'));
for (const r of rows) if (r.crop) (png(r.name, r.crop), png('source', r.sourceCrop), delete r.crop, delete r.sourceCrop);
if (result.caps) console.log(result.caps);
console.table(rows.map((r) => (r.afterText ? { ...r, afterText: r.afterText.join(' / ') } : r)));
fs.mkdirSync(path.join(root, 'results'), { recursive: true });
fs.writeFileSync(path.join(root, 'results', PAGE.replace('.html', '.json')), JSON.stringify(result, null, 1));
await browser.close();
srv.close();
