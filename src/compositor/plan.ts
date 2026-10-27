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

/** Who you hear: the director, plus whoever is on stage (everyone on the end screen). */
export function audible(stage: Stage, peer: PeerId, director: PeerId) {
  return peer === director || stage.kind === 'end' || stage.id === peer;
}

export function gridFor(n: number, W: number, H: number, gap: number) {
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  const cw = (W - gap * (cols + 1)) / cols;
  const ch = Math.min((H - gap * (rows + 1)) / rows, (cw * 9) / 16);
  const cwFit = Math.min(cw, (ch * 16) / 9);
  const totalH = rows * ch + (rows - 1) * gap;
  const top = (H - totalH) / 2;
  const cells: { x: number; y: number; w: number; h: number }[] = [];
  for (let i = 0; i < n; i++) {
    const r = Math.floor(i / cols);
    const inRow = Math.min(cols, n - r * cols); // centre a short last row
    const rowW = inRow * cwFit + (inRow - 1) * gap;
    const c = i - r * cols;
    cells.push({ x: (W - rowW) / 2 + c * (cwFit + gap), y: top + r * (ch + gap), w: cwFit, h: ch });
  }
  return cells;
}
