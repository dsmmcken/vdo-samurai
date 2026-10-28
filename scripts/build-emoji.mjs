// Builds src/lib/emoji.json (committed) for the reaction picker: the animated
// Noto emoji, their categories and popularity, and a search index of their
// words (Noto's short names joined with CLDR keywords from emojibase) and the
// hand-written concept groups in emoji-concepts.mjs.
// Only needed when either source or the groups change: npm run build:emoji
import fs from 'node:fs';
import concepts from './emoji-concepts.mjs';
import { stem, words } from '../src/lib/emoji-search.ts';

const NOTO = 'https://googlefonts.github.io/noto-emoji-animation/data/api.json';
const CLDR = 'https://cdn.jsdelivr.net/npm/emojibase-data@16.0.3/en/compact.json';
const QUICK = '👍❤️😂🎉😮👏🔥🚀';
const SKIP = new Set(['with', 'and', 'of', 'the', 'a', 'in', 'on', 'for', 'to']);

const get = async (url) => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
};
const [{ icons }, cldr] = await Promise.all([get(NOTO), get(CLDR)]);

// Hexcodes meet as lowercase, dash-separated, 4+ digits, without fe0f.
const norm = (h) => h.toLowerCase().split(/[-_]/).filter((p) => p !== 'fe0f').map((p) => p.padStart(4, '0')).join('-');
const byHex = new Map();
for (const e of cldr) {
  byHex.set(norm(e.hexcode), e);
  for (const s of e.skins ?? []) byHex.set(norm(s.hexcode), e);
}
const TONE = /_1f3f[b-f]/;
const all = new Set(icons.map((i) => i.codepoint));
// Skin tones come from the picker's tone setting: only the default goes in the grid.
const base = icons.filter((i) => !TONE.test(i.codepoint));
const cats = [...new Set(base.map((i) => i.categories[0]))];
const toned = (cp, t) => {
  const p = cp.split('_').filter((x) => x !== 'fe0f');
  p.splice(1, 0, t);
  return p.join('_');
};
const index = new Map(base.map((i, n) => [norm(i.codepoint), n]));

const w = {};
const add = (word, n, name) => {
  const s = stem(word);
  if (!s || SKIP.has(s)) return;
  const v = n * 2 + (name ? 1 : 0);
  const list = (w[s] ??= []);
  const at = list.findIndex((x) => x >> 1 === n);
  if (at < 0) list.push(v);
  else list[at] |= v; // a name word wins over a keyword
};
let matched = 0;
const e = base.map((icon, n) => {
  const cldrE = byHex.get(norm(icon.codepoint));
  if (cldrE) matched++;
  for (const t of icon.tags) for (const x of words(t.replace(/:/g, '').replace(/-/g, ' '))) add(x, n, true);
  for (const x of words((cldrE?.label ?? '').replace(/-/g, ' '))) add(x, n, true);
  for (const t of cldrE?.tags ?? []) for (const x of words(t.replace(/-/g, ' '))) add(x, n, false);
  const tones = ['1f3fb', '1f3fc', '1f3fd', '1f3fe', '1f3ff'].every((t) => all.has(toned(icon.codepoint, t)));
  const row = [icon.codepoint, cldrE?.label ?? icon.tags[0].replace(/:/g, '').replace(/-/g, ' '), cats.indexOf(icon.categories[0]), icon.popularity];
  if (tones) row.push(1);
  return row;
});

// Emoji strings split into single emoji (ZWJ sequences and all).
const seg = new Intl.Segmenter('en', { granularity: 'grapheme' });
const lookup = (ch) => index.get(norm([...ch].map((c) => c.codePointAt(0).toString(16)).join('-')));
const missing = new Set();
const c = concepts.map(([terms, emoji]) => {
  const idx = [];
  for (const { segment } of seg.segment(emoji)) {
    const n = lookup(segment);
    if (n === undefined) missing.add(segment);
    else if (!idx.includes(n)) idx.push(n);
  }
  const t = [...new Set(terms.split(/,\s*/).map((p) => words(p).map(stem).join(' ')).filter(Boolean))];
  return [t, idx];
});
const q = [...seg.segment(QUICK)].map(({ segment }) => lookup(segment));
if (q.includes(undefined)) throw new Error('a quick reaction is not animated');

const out = new URL('../src/lib/emoji.json', import.meta.url);
const json = JSON.stringify({ cats, e, w, c, q });
fs.writeFileSync(out, json + '\n');
const gz = (await import('node:zlib')).gzipSync(json).length;
console.log(`emoji.json: ${e.length} emoji (${matched} with CLDR keywords, ${icons.length - base.length} skin-tone variants via the tone setting), ${Object.keys(w).length} words, ${c.length} concept groups; ${(json.length / 1024).toFixed(1)} KB, ${(gz / 1024).toFixed(1)} KB gzipped`);
if (missing.size) console.log(`not animated, left out of concept groups: ${[...missing].join(' ')}`);
