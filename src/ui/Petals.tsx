// Cherry blossom petals that drift down inside a button while it's hovered.
// Purely decorative: positions and timings are fixed per petal so they don't
// re-randomize on every render.
const PETALS = [
  { x: 8, s: 7, d: 3.4, delay: 0, sway: 10 },
  { x: 22, s: 5, d: 2.8, delay: 1.1, sway: -8 },
  { x: 37, s: 8, d: 3.9, delay: 0.5, sway: 12 },
  { x: 51, s: 6, d: 3.1, delay: 1.8, sway: -10 },
  { x: 64, s: 7, d: 3.6, delay: 0.2, sway: 9 },
  { x: 77, s: 5, d: 2.9, delay: 1.4, sway: -12 },
  { x: 89, s: 6, d: 3.3, delay: 0.8, sway: 8 },
  { x: 45, s: 4, d: 2.6, delay: 2.2, sway: -6 },
];

export function Petals() {
  return (
    <span className="petals" aria-hidden>
      {PETALS.map((p, i) => (
        <span
          key={i}
          className="petal"
          style={{ '--x': `${p.x}%`, '--s': `${p.s}px`, '--d': `${p.d}s`, '--delay': `${p.delay}s`, '--sway': `${p.sway}px` } as React.CSSProperties}
        />
      ))}
    </span>
  );
}
