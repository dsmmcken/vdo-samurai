import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * A small (?) whose hint shows on hover or focus. Drawn on top of everything
 * (in a portal), so scrolling panels and modal edges never cut it off; kept
 * inside the window, flipping above when there's no room below.
 */
export function Tip({ text }: { text: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const tip = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    if (!open || !ref.current || !tip.current) return setAt(null);
    const r = ref.current.getBoundingClientRect();
    const t = tip.current.getBoundingClientRect();
    const left = Math.max(8, Math.min(window.innerWidth - t.width - 8, r.left + r.width / 2 - t.width / 2));
    const below = r.bottom + 8;
    const top = below + t.height > window.innerHeight - 8 ? r.top - t.height - 8 : below;
    setAt({ left, top });
  }, [open, text]);
  const show = () => setOpen(true);
  const hide = () => setOpen(false);
  return (
    <span ref={ref} className="tip" tabIndex={0} aria-label={text} onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide}>
      ?
      {open &&
        createPortal(
          <span ref={tip} className="tip-pop" role="tooltip" style={at ? { left: at.left, top: at.top } : { left: -9999, top: 0 }}>
            {text}
          </span>,
          document.body,
        )}
    </span>
  );
}
