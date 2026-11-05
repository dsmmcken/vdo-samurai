// Bundles <name>.ts, serves this folder and runs it in headless Chromium,
// printing window.result. Usage: CHROME=/path/to/chrome node run-headless.mjs exact
import { chromium } from 'playwright-core';
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { serve } from './serve.mjs';

const root = path.dirname(new URL(import.meta.url).pathname);
const name = process.argv[2] ?? 'exact';
// The app's `?url` imports (model, kernels) resolve to /app/... here.
const src = path.join(root, '../../src');
const urls = {
  name: 'urls',
  setup(b) {
    b.onResolve({ filter: /\?url$/ }, (a) => ({ path: path.resolve(a.resolveDir, a.path.replace(/\?url$/, '')), namespace: 'url' }));
    b.onLoad({ filter: /.*/, namespace: 'url' }, (a) => ({ contents: `export default ${JSON.stringify('/app/' + path.relative(src, a.path))}`, loader: 'js' }));
  },
};
await build({ entryPoints: [path.join(root, `${name}.ts`)], bundle: true, format: 'esm', outfile: path.join(root, 'build', `${name}.js`), logLevel: 'warning', plugins: [urls] });
fs.writeFileSync(path.join(root, 'build', `${name}.html`), `<!doctype html><meta charset="utf-8"><body><script type="module" src="${name}.js"></script>`);
const srv = serve(8099);
const browser = await chromium.launch({ executablePath: process.env.CHROME, args: ['--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
page.on('console', (m) => console.log('[page]', m.text()));
page.on('pageerror', (e) => {
  console.error('page error:', e.message);
  process.exit(1);
});
await page.goto(`http://localhost:8099/build/${name}.html${process.argv[3] ?? ''}`);
await page.waitForFunction(() => window.result, null, { timeout: 300000 });
const result = await page.evaluate(() => window.result);
for (const [file, b64] of Object.entries(result.images ?? {})) {
  fs.mkdirSync(path.join(root, 'results'), { recursive: true });
  fs.writeFileSync(path.join(root, 'results', file), Buffer.from(b64, 'base64'));
  console.log(`wrote results/${file}`);
}
console.log(typeof result.text === 'string' ? result.text : JSON.stringify(result, null, 1));
await browser.close();
srv.close();
