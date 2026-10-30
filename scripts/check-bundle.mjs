// After `vite build`: fails if the page's first load (the entry script and
// whatever it imports statically) carries the reaction player or the emoji
// list. Those must load on demand. Part of npm run build.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const dist = new URL('../dist/', import.meta.url).pathname;
const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
const entry = html.match(/<script[^>]+src="\.?\/?([^"]+\.js)"/)?.[1];
if (!entry) throw new Error('no entry script in dist/index.html');

// What must stay out, and a string only it contains.
const banned = {
  'reaction player (dotlottie-web)': /setWasmUrl|dotlottie-player/,
  'emoji data (emoji.json)': /grinning face with big eyes/,
  'noise reduction (fastenhancer-web)': /fastenhancer-processor/,
  'reaction search (emoji-search.ts)': /half-typed|EmojiSearch|\(i\|in\|e\|es\|s\)/,
};
const seen = new Set();
const walk = (file) => {
  if (seen.has(file)) return;
  seen.add(file);
  const src = fs.readFileSync(path.join(dist, file), 'utf8');
  // Static imports only: `import("...")` is on demand, which is the point.
  for (const [, dep] of src.matchAll(/(?:^|[;\s}])import\s*(?:[\w${}*,\s]+from\s*)?["']\.\/([^"']+\.js)["']/g)) walk(path.join(path.dirname(file), dep));
};
walk(entry);
let bad = 0, bytes = 0, gz = 0;
for (const file of seen) {
  const src = fs.readFileSync(path.join(dist, file));
  bytes += src.length;
  gz += zlib.gzipSync(src).length;
  for (const [what, re] of Object.entries(banned)) if (re.test(src.toString())) console.error(`✗ ${file} contains the ${what}`), bad++;
}
console.log(`first load: ${[...seen].join(', ')}: ${(bytes / 1000).toFixed(1)} kB, ${(gz / 1000).toFixed(1)} kB gzipped`);
if (bad) process.exit(1);
console.log('✓ no reaction player, search, emoji data or noise reduction in it');
