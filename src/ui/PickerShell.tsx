// What the reaction picker needs before its own chunk arrives: a stand-in with
// the same layout (search box live, skeleton cells), the category icons, and
// the emoji font. Small, so it ships with the page; everything heavy stays in
// ReactionPicker, loaded on first open.
import { useEffect, useRef } from 'react';

const FONT = 'https://fonts.googleapis.com/css2?family=Noto+Color+Emoji&display=swap';

/** The Noto Color Emoji stylesheet, added on first use; `load` waits for the glyphs of `text`. */
export const emojiFont = {
  ready: false,
  sheet: null as Promise<void> | null,
  start() {
    return (this.sheet ??= new Promise<void>((done) => {
      const l = document.createElement('link');
      l.rel = 'stylesheet';
      l.href = FONT;
      l.onload = l.onerror = () => done();
      document.head.appendChild(l);
    }));
  },
  /** Resolves once those glyphs are in (or after 4 s: then fallback glyphs it is). */
  async load(text: string) {
    const fonts = this.start().then(() => document.fonts.load('26px "Noto Color Emoji"', text));
    await Promise.race([fonts.catch(() => {}), new Promise((r) => setTimeout(r, 4000))]);
    this.ready = true;
  },
};

/** Whatever was typed into the stand-in (and an Enter pressed there), handed to the picker when it takes over. */
export const draft = {
  q: '',
  enter: false,
  take() {
    const q = this.q;
    this.q = '';
    return q;
  },
};

// Category tabs: plain outline glyphs, so they don't read as more reactions.
// Category tabs: plain outline glyphs, so they don't read as more reactions.
const line = (...d: React.ReactNode[]) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {d}
  </svg>
);
export const TABS = [
  line(<circle key="a" cx="12" cy="12" r="9" />, <path key="b" d="M8.5 14.5s1.3 1.8 3.5 1.8 3.5-1.8 3.5-1.8M9 9.5h.01M15 9.5h.01" />),
  line(<circle key="a" cx="12" cy="8" r="3.6" />, <path key="b" d="M4.5 20.5c0-3.9 3.4-6 7.5-6s7.5 2.1 7.5 6" />),
  line(<circle key="a" cx="6.5" cy="10" r="1.7" />, <circle key="b" cx="10" cy="6" r="1.7" />, <circle key="c" cx="14" cy="6" r="1.7" />, <circle key="d" cx="17.5" cy="10" r="1.7" />, <path key="e" d="M12 12.5c-2.4 0-5 3-5 5.1 0 1.5 1.2 2.2 2.5 2.2 1 0 1.6-.5 2.5-.5s1.5.5 2.5.5c1.3 0 2.5-.7 2.5-2.2 0-2.1-2.6-5.1-5-5.1z" />),
  line(<path key="a" d="M4 9h12v4.5A5.5 5.5 0 0 1 10.5 19h-1A5.5 5.5 0 0 1 4 13.5V9zM16 10.5h1.5a2.5 2.5 0 0 1 0 5H16M8 3.5v2.5M12 3.5v2.5" />),
  line(<path key="a" d="M3.5 16.5v-4l2-5.5h13l2 5.5v4zM3.5 12.5h17" />, <circle key="b" cx="7.5" cy="16.5" r="1.8" />, <circle key="c" cx="16.5" cy="16.5" r="1.8" />),
  line(<circle key="a" cx="12" cy="12" r="9" />, <path key="b" d="M12 7.5l4 3-1.5 4.5h-5L8 10.5zM12 3v4.5M16 10.5l4.3-1.4M14.5 15l2.7 3.6M9.5 15l-2.7 3.6M8 10.5 3.7 9.1" />),
  line(<path key="a" d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.8 10.6c.6.6.8 1.4.8 2.4h6c0-1 .2-1.8.8-2.4A6 6 0 0 0 12 3z" />),
  line(<path key="a" d="M12 20s-7.5-4.6-7.5-10.2A4.1 4.1 0 0 1 12 7.4a4.1 4.1 0 0 1 7.5 2.4C19.5 15.4 12 20 12 20z" />),
  line(<path key="a" d="M5 21V3.5M5 4h12l-2.5 4.5L17 13H5" />),
];

const cells = (n: number) => Array.from({ length: n }, (_, i) => <span key={i} className="skel" />);

/** The picker's frame while its code loads: same boxes, skeleton emoji, a search box you can already type into. */
export function PickerShell() {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    emojiFont.start();
    const raf = requestAnimationFrame(() => input.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div className="picker loading" aria-busy>
      <div className="picker-head">
        <span className="picker-credit">Animated Noto Emoji, CC BY 4.0</span>
        <span className="skel picker-tone-skel" />
      </div>
      <div className="picker-tabs">
        {TABS.map((t, k) => (
          <button key={k} disabled tabIndex={-1}>
            {t}
          </button>
        ))}
      </div>
      <div className="picker-grid">
        <span className="skel picker-h-skel" />
        <div className="picker-cells">{cells(45)}</div>
      </div>
      <div className="picker-popular">
        <h4>Popular</h4>
        <div className="picker-quick">{cells(8)}</div>
      </div>
      <input
        ref={input}
        className="picker-search"
        type="search"
        placeholder="Search: nice job, ship it, lol…"
        aria-label="Search reactions"
        onChange={(e) => ((draft.q = e.target.value), (draft.enter = false))}
        onKeyDown={(e) => e.key === 'Enter' && (draft.enter = true)}
      />
    </div>
  );
}
