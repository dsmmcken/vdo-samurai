// Small shared helpers.

/** Wall-clock milliseconds with sub-ms precision; used for cross-peer timing. */
export const now = () => performance.timeOrigin + performance.now();

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';
export function rid(n = 8) {
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}

const WORDS_A = ['swift', 'quiet', 'iron', 'crimson', 'silver', 'misty', 'bold', 'golden', 'hidden', 'stone'];
const WORDS_B = ['crane', 'blade', 'lotus', 'tiger', 'river', 'ronin', 'maple', 'fox', 'temple', 'storm'];
export function roomSlug() {
  const pick = (a: string[]) => a[crypto.getRandomValues(new Uint8Array(1))[0] % a.length];
  return `${pick(WORDS_A)}-${pick(WORDS_B)}-${rid(4)}`;
}

export function fmtBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

export function fmtClock(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
