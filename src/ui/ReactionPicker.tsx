// The reaction picker: loaded (with the search and the emoji list) the first
// time someone opens it; until then PickerShell stands in, laid out the same.
// Static emoji in the grid come from the Noto Color Emoji font, also fetched
// only once it opens; Google serves it in pieces by unicode range, so only the
// pieces on screen download. Cells stay skeletons until the first pieces land.
import { useEffect, useMemo, useRef, useState } from 'react';
import { draft, emojiFont, TABS } from './PickerShell';
import data from '../lib/emoji.json';
import { EmojiSearch, emojiChar, toned, TONES, type EmojiData } from '../lib/emoji-search';

const emoji = data as unknown as EmojiData;
const search = new EmojiSearch(emoji);

const TONE_KEY = 'samurai:tone';

/**
 * Arrow keys move between the picker's buttons by where they sit on screen,
 * so one rule walks the grid, crosses sections and steps between rows of
 * different lengths. Up / down stay inside an area (the head, tabs, grid,
 * popular row) and move to the next area's visible buttons at its edge.
 * Left / right follow reading order, wrapping rows.
 */
function nextButton(root: HTMLElement, from: HTMLElement, key: string) {
  const area = from.closest<HTMLElement>('[data-area]')!;
  const inArea = [...area.querySelectorAll<HTMLElement>('[data-nav]')];
  if (key === 'ArrowLeft' || key === 'ArrowRight') return inArea[inArea.indexOf(from) + (key === 'ArrowRight' ? 1 : -1)];
  const dir = key === 'ArrowDown' ? 1 : -1;
  const box = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, h: r.height, r };
  };
  const a = box(from);
  const nearest = (els: HTMLElement[], ok: (b: ReturnType<typeof box>) => boolean) => {
    let best: HTMLElement | undefined, score = Infinity;
    for (const el of els) {
      const b = box(el);
      if (!ok(b)) continue;
      const s = (b.y - a.y) * dir * 1000 + Math.abs(b.x - a.x); // nearest row first, then nearest in it
      if (s < score) (score = s), (best = el);
    }
    return best;
  };
  const within = nearest(inArea, (b) => (b.y - a.y) * dir >= Math.min(a.h, b.h) / 2);
  if (within) return within;
  const areas = [...root.querySelectorAll<HTMLElement>('[data-area]')];
  for (let i = areas.indexOf(area) + dir; i >= 0 && i < areas.length; i += dir) {
    const view = areas[i].getBoundingClientRect(); // the grid scrolls: only what's showing
    const next = nearest([...areas[i].querySelectorAll<HTMLElement>('[data-nav]')], (b) => b.r.bottom > view.top + 4 && b.r.top < view.bottom - 4);
    if (next) return next;
  }
}


export default function ReactionPicker({ onPick }: { onPick: (cp: string) => void }) {
  const [q, setQ] = useState(() => draft.take());
  const [fontReady, setFontReady] = useState(emojiFont.ready);
  useEffect(() => {
    if (fontReady) return;
    let live = true;
    // The popular row and the top of the grid: the pieces needed first.
    const sample = [...emoji.q, ...emoji.e.slice(0, 60).map((_, i) => i)].map((i) => emojiChar(emoji.e[i][0])).join('');
    emojiFont.load(sample).then(() => live && setFontReady(true));
    return () => {
      live = false;
    };
  }, []);
  const [tone, setTone] = useState(() => {
    try {
      return Number(localStorage.getItem(TONE_KEY)) || 0;
    } catch {
      return 0;
    }
  });
  const grid = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [cat, setCat] = useState(0);
  // The popover is hidden for its first frame while it measures itself, and a
  // hidden input can't take focus, so autoFocus alone doesn't work.
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      const el = input.current;
      el?.focus();
      el?.setSelectionRange(el.value.length, el.value.length);
    });
    return () => cancelAnimationFrame(raf);
  }, []);
  /** The tab follows the category scrolled into view. */
  const onScroll = () => {
    const g = grid.current!;
    const secs = [...g.querySelectorAll<HTMLElement>('section')];
    const at = secs.filter((el) => el.offsetTop - g.offsetTop <= g.scrollTop + 8).length - 1;
    setCat(Math.max(0, at));
  };
  const results = useMemo(() => (q.trim() ? search.search(q) : null), [q]);
  // Enter pressed in the stand-in before we loaded: send the top result now.
  useEffect(() => {
    if (draft.enter && results?.length) onPick(cp(results[0]));
    draft.enter = false;
  }, []);
  const cp = (i: number) => (emoji.e[i][4] ? toned(emoji.e[i][0], TONES[tone]) : emoji.e[i][0]);
  // One tab stop per group (the first emoji in it); arrows do the rest.
  const cell = (i: number, n: number) => (
    <button key={i} className="em" data-nav tabIndex={n ? -1 : 0} onClick={() => onPick(cp(i))} title={emoji.e[i][1]} aria-label={emoji.e[i][1]}>
      <span>{emojiChar(cp(i))}</span>
    </button>
  );
  const first = emoji.e.findIndex((e) => e[2] === 0);
  const [toning, setToning] = useState(false);
  const head = useRef<HTMLDivElement>(null);
  // Opening the tones swaps out the button that had focus: keep focus with it.
  const toned1 = useRef(false);
  useEffect(() => {
    if (toned1.current) head.current?.querySelector<HTMLElement>(toning ? '[aria-checked="true"]' : '.picker-tone')?.focus();
    toned1.current = true;
  }, [toning]);

  /**
   * Keyboard: arrows move between emoji, tabs and tones; from the search box,
   * up / down go to the first result (or, unfiltered, up to the popular row);
   * typing anywhere goes back to the search box.
   */
  const onKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const root = e.currentTarget, el = e.target as HTMLElement;
    if (el === input.current) {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      e.preventDefault();
      root.querySelector<HTMLElement>(results ? '.picker-grid [data-nav]' : '.picker-quick [data-nav]')?.focus();
      return;
    }
    if (!el.hasAttribute('data-nav')) return;
    if (e.key.startsWith('Arrow')) {
      e.preventDefault();
      const next = nextButton(root, el, e.key);
      if (next) next.focus();
      else if (e.key === 'ArrowDown') input.current?.focus(); // below the last row: the search box
    } else if ((e.key.length === 1 && e.key !== ' ' && !e.ctrlKey && !e.metaKey && !e.altKey) || e.key === 'Backspace') {
      input.current?.focus(); // the key lands in the search box
    }
  };
  const pickTone = (t: number) => {
    setTone(t);
    setToning(false);
    try {
      localStorage.setItem(TONE_KEY, String(t));
    } catch {}
  };

  // Upside down from the usual: the picker opens above its button, so the
  // search and the popular row sit at the bottom, nearest the pointer.
  return (
    <div className={`picker ${fontReady ? '' : 'loading'}`} onKeyDown={onKey}>
      <div className="picker-head" data-area ref={head}>
        <a className="picker-credit" href="https://googlefonts.github.io/noto-emoji-animation/" target="_blank" rel="noopener noreferrer">
          Animated Noto Emoji, CC BY 4.0
        </a>
        {/* Sets the skin tone of the emoji below; it isn't a reaction itself. */}
        {toning ? (
          <div className="picker-tones" role="radiogroup" aria-label="Skin tone">
            {TONES.map((t, k) => (
              <button key={k} data-nav tabIndex={k === tone ? 0 : -1} role="radio" aria-checked={k === tone} className={k === tone ? 'on' : ''} onClick={() => pickTone(k)} title={k ? 'Skin tone' : 'Default skin tone'}>
                {emojiChar(toned('270b', t))}
              </button>
            ))}
          </div>
        ) : (
          <button className="picker-tone" data-nav onClick={() => setToning(true)} title="Change skin tone" aria-label="Skin tone">
            <span className="picker-tone-label">Skin tone</span>
            <span>{emojiChar(toned('270b', TONES[tone]))}</span>
          </button>
        )}
      </div>
      {!results && (
        <div className="picker-tabs" data-area role="tablist">
          {emoji.cats.map((c, k) => (
            <button
              key={c}
              data-nav
              tabIndex={cat === k ? 0 : -1}
              role="tab"
              aria-selected={cat === k}
              title={c}
              aria-label={c}
              onClick={() => grid.current?.querySelector(`[data-cat="${k}"]`)?.scrollIntoView({ block: 'start' })}
            >
              {TABS[k]}
            </button>
          ))}
        </div>
      )}
      <div className="picker-grid" data-area ref={grid} onScroll={results ? undefined : onScroll}>
        {results ? (
          results.length ? (
            <div className="picker-cells">{results.map(cell)}</div>
          ) : (
            <div className="empty">No reactions match.</div>
          )
        ) : (
          emoji.cats.map((c, k) => (
            <section key={c} data-cat={k}>
              <h4>{c}</h4>
              <div className="picker-cells">{emoji.e.flatMap((e, i) => (e[2] === k ? [cell(i, k ? 1 : i - first)] : []))}</div>
            </section>
          ))
        )}
      </div>
      {!results && (
        <div className="picker-popular">
          <h4>Popular</h4>
          <div className="picker-quick" data-area role="group" aria-label="Popular reactions">
            {emoji.q.map(cell)}
          </div>
        </div>
      )}
      <input
        ref={input}
        className="picker-search"
        type="search"
        placeholder="Search: nice job, ship it, lol…"
        aria-label="Search reactions"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && results?.length && onPick(cp(results[0]))}
      />
    </div>
  );
}
