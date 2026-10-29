// Turns the director's stage log into an edit decision list.
import type { DirectorManifest, PeerId, Stage } from '../lib/types';

export interface Segment {
  start: number; // seconds
  end: number;
  stage: Stage;
}

export const LOWER_THIRD_S = 5;

export function segments(m: DirectorManifest): Segment[] {
  const duration = ((m.take.stopAt ?? m.take.startAt) - m.take.startAt) / 1000;
  const log = [...m.stageLog].sort((a, b) => a.t - b.t);
  const fallback: Stage = { kind: 'peer', id: m.take.director, view: 'cam' };
  if (!log.length) return [{ start: 0, end: duration, stage: fallback }];
  const out: Segment[] = [];
  log.forEach((e, i) => {
    const start = i === 0 ? 0 : Math.min(duration, e.t / 1000);
    const end = i + 1 < log.length ? Math.min(duration, log[i + 1].t / 1000) : duration;
    if (end > start) out.push({ start, end, stage: e.stage });
  });
  // Merge back-to-back identical stages so lower thirds and audio don't stutter.
  return out.reduce<Segment[]>((acc, s) => {
    const prev = acc[acc.length - 1];
    if (prev && JSON.stringify(prev.stage) === JSON.stringify(s.stage)) prev.end = s.end;
    else acc.push({ ...s });
    return acc;
  }, []);
}

/**
 * Each person's lower third runs for 5 s the first time they're on stage (not
 * the end screen). It waits a beat after the cut, and longer at the very start
 * of the video, so it doesn't land on the first frame.
 */
export function lowerThirds(segs: Segment[], videoStart = 0) {
  const out = new Map<PeerId, { start: number; end: number }>();
  for (const s of segs) {
    if (s.stage.kind !== 'peer' || out.has(s.stage.id) || s.end <= videoStart) continue;
    const from = Math.max(s.start, videoStart);
    const start = from + (from === videoStart ? 1.5 : 0.6);
    const end = Math.min(s.end, start + LOWER_THIRD_S);
    if (end - start >= 1.5) out.set(s.stage.id, { start, end });
  }
  return out;
}

/**
 * Recorders start a beat after the countdown hits zero. Start the edit once the
 * files that begin near zero all have frames (capped, so one very late joiner
 * can't eat the start of the take).
 */
export function videoStart(fileStarts: number[], cap = 3) {
  return Math.min(cap, Math.max(0, ...fileStarts.filter((t) => t < cap)));
}

/** Padding around each stretch a recording is shown, for clock differences between people. */
export const SHOWN_PAD_S = 1;

/**
 * The stretches (take seconds, padded) of `peer`'s recording the edit shows:
 * their camera while they're on stage (full frame, or as the overlay on their
 * screen) and on the end screen; their screen while it's on stage. Guests
 * upload only these (cut.ts).
 */
export function shownSpans(m: DirectorManifest, peer: PeerId, kind: 'cam' | 'screen'): [number, number][] {
  return segments(m)
    .filter(({ stage }) => (kind === 'cam' ? stage.kind === 'end' || stage.id === peer : stage.kind === 'peer' && stage.id === peer && stage.view === 'screen'))
    .map((s) => [s.start - SHOWN_PAD_S, s.end + SHOWN_PAD_S]);
}

/** Who you hear: the director, plus whoever is on stage (everyone on the end screen). */
export function audible(stage: Stage, peer: PeerId, director: PeerId) {
  return peer === director || stage.kind === 'end' || stage.id === peer;
}

/**
 * End-screen rows: every row spans the full width and rows share the height,
 * so odd counts don't leave holes (3 = one row of 3, 5 = 3 over 2, 7 = 4 over
 * 3). Videos are cropped to fill their cells.
 */
export function endRows(n: number): number[] {
  const table: Record<number, number[]> = { 1: [1], 2: [2], 3: [3], 4: [2, 2], 5: [3, 2], 6: [3, 3], 7: [4, 3], 8: [4, 4] };
  if (table[n]) return table[n];
  const perRow = Math.ceil(n / Math.ceil(n / 4)); // beyond 8: rows of up to 4, fullest first
  const rows: number[] = [];
  for (let left = n; left > 0; left -= perRow) rows.push(Math.min(perRow, left));
  return rows;
}

export function gridFor(n: number, W: number, H: number, gap: number) {
  const rows = endRows(n);
  const rh = (H - gap * (rows.length + 1)) / rows.length;
  const cells: { x: number; y: number; w: number; h: number }[] = [];
  rows.forEach((count, r) => {
    const cw = (W - gap * (count + 1)) / count;
    for (let c = 0; c < count; c++) cells.push({ x: gap + c * (cw + gap), y: gap + r * (rh + gap), w: cw, h: rh });
  });
  return cells;
}
