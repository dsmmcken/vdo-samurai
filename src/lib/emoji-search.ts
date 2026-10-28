// Reaction search over the animated Noto emoji: a cheap, fake "semantic" fuzzy
// search with no model. The index is built ahead of time (scripts/build-emoji.mjs,
// which imports stem() from here so both sides agree); this ranks it:
// a word of the emoji's name, then hand-written concept groups, then its other
// keywords, then prefixes (as you type), then one-letter typos; ties by popularity.
// Every word of the query must match.

export interface EmojiData {
  /** Category names, in tab order. */
  cats: string[];
  /** [codepoint, name, category, popularity (higher is more used), 1 if it has skin tones], in grid order. */
  e: [string, string, number, number, number?][];
  /** Stemmed word -> emoji index * 2, + 1 when the word is part of its name. */
  w: Record<string, number[]>;
  /** Concept groups: stemmed words and phrases, emoji indices in rank order. */
  c: [string[], number[]][];
  /** The quick row. */
  q: number[];
}

const NAME = 5, CONCEPT = 4, WORD = 3.5, PREFIX = 2, TYPO = 1;
/** Words that don't have to match anything ("ship it", "the best"). */
const OPTIONAL = new Set(['it', 'a', 'an', 'the', 'is', 'so', 'to', 'of', 'for', 'on', 'at', 'in', 'my', 'that', 'very', 'really']);

/** Light stemming: -ing, -ed, -es, -s, then a final e; "shipping" and "ship", "celebrating" and "celebrate" meet. */
export function stem(w: string) {
  if (w.length <= 3 || !/^[a-z]+$/.test(w)) return w;
  for (const suf of ['ing', 'ed', 'es', 's']) {
    if (!w.endsWith(suf) || w.length - suf.length < 3 || (suf === 's' && w.endsWith('ss'))) continue;
    w = w.slice(0, -suf.length);
    if (suf === 'ing' || suf === 'ed') if (/([b-df-hj-np-tv-z])\1$/.test(w) && !/(ll|ss|zz)$/.test(w)) w = w.slice(0, -1);
    break;
  }
  return w.length > 3 && w.endsWith('e') ? w.slice(0, -1) : w;
}

/** Lowercase words, apostrophes dropped, punctuation trimmed (a word of only symbols, like "+1" or "<3", stays). */
export function words(s: string) {
  return s
    .toLowerCase()
    .replace(/['’]/g, '')
    .split(/[\s,]+/)
    .map((t) => (/[a-z0-9]/.test(t) ? t.replace(/^[^a-z0-9+-]+|[^a-z0-9]+$/g, '') : t))
    .filter(Boolean);
}

/** At most one edit apart (insert, delete, substitute or swap two neighbours). */
function near(a: string, b: string) {
  if (Math.abs(a.length - b.length) > 1 || a === b) return a === b;
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1) || (a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2));
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
}

export class EmojiSearch {
  private concepts = new Map<string, number[]>();
  private vocab: string[];
  readonly data: EmojiData;

  constructor(data: EmojiData) {
    this.data = data;
    data.c.forEach(([terms], g) => terms.forEach((t) => this.concepts.set(t, [...(this.concepts.get(t) ?? []), g])));
    this.vocab = [...new Set([...Object.keys(data.w), ...this.concepts.keys()])];
  }

  /** Emoji indices, best first. */
  search(query: string, limit = 64): number[] {
    const units = this.units(words(query).map(stem));
    let total: Map<number, number> | null = null;
    for (const u of units) {
      const s = this.scores(u);
      if (!s.size && OPTIONAL.has(u)) continue;
      if (!total) total = s;
      else for (const [i, v] of total) s.has(i) ? total.set(i, v + s.get(i)!) : total.delete(i);
    }
    if (!total) return [];
    const pop = (i: number) => this.data.e[i][3];
    return [...total].sort((a, b) => b[1] - a[1] || pop(b[0]) - pop(a[0])).slice(0, limit).map(([i]) => i);
  }

  /** Joins neighbouring words that make up a concept phrase ("nice job", "ship it"); the last may be half typed. */
  private units(ws: string[]) {
    const out: string[] = [];
    for (let i = 0; i < ws.length; i++) {
      let best = i;
      for (let j = i + 1; j < ws.length; j++) {
        const p = ws.slice(i, j + 1).join(' ');
        if (this.concepts.has(p) || (j === ws.length - 1 && this.vocab.some((v) => v.startsWith(p)))) best = j;
      }
      out.push(ws.slice(i, best + 1).join(' '));
      i = best;
    }
    return out;
  }

  /** How well each emoji matches one word (or phrase) of the query. */
  private scores(u: string) {
    const direct = new Map<number, number>(), concept = new Map<number, number>();
    const add = (m: Map<number, number>, i: number, v: number) => v > (m.get(i) ?? 0) && m.set(i, v);
    const typo = u.length >= 4 && /^[a-z]+$/.test(u);
    for (const v of this.vocab) {
      // A half-typed ending counts as a prefix too ("laughi" for laugh).
      const kind = v === u ? 0 : v.startsWith(u) || (v.length >= 4 && u.startsWith(v) && /^(i|in|e|es|s)$/.test(u.slice(v.length))) ? 1 : typo && near(u, v) ? 2 : -1;
      if (kind < 0) continue;
      for (const n of this.data.w[v] ?? []) add(direct, n >> 1, [n & 1 ? NAME : WORD, PREFIX, TYPO][kind]);
      // Inside a group its hand-written order counts, ahead of popularity.
      for (const g of this.concepts.get(v) ?? []) {
        const list = this.data.c[g][1];
        list.forEach((i, k) => add(concept, i, [CONCEPT, PREFIX, TYPO][kind] + 0.4 * (1 - k / list.length)));
      }
    }
    // Both its own words and a concept group: the surest answer ("heart" is ❤️ before 😘).
    for (const [i, c] of concept) {
      const d = direct.get(i) ?? 0;
      direct.set(i, d >= WORD && c >= CONCEPT ? NAME + 1 + c - CONCEPT : Math.max(c, d));
    }
    return direct;
  }
}

/** The emoji itself, from a Noto codepoint like 1f44b_1f3fb. */
export const emojiChar = (cp: string) => String.fromCodePoint(...cp.split('_').map((h) => parseInt(h, 16)));

export const TONES = ['', '1f3fb', '1f3fc', '1f3fd', '1f3fe', '1f3ff'];

/** The codepoint in a skin tone: the modifier goes after the first character (any fe0f dropped). */
export function toned(cp: string, tone: string) {
  if (!tone) return cp;
  const parts = cp.split('_').filter((p) => p !== 'fe0f');
  parts.splice(1, 0, tone);
  return parts.join('_');
}
