import { useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * A small floating panel anchored above (or below) an element. Closes on
 * outside click or Escape. Not modal: the rest of the room keeps working.
 * A press on the anchor itself is left to the anchor, whose click toggles the
 * popover: closing here first would have that click open it again.
 */
export function Popover({ anchor, onClose, children, align = 'center' }: { anchor: DOMRect; onClose: () => void; children: React.ReactNode; align?: 'center' | 'start' | 'end' }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let left = align === 'start' ? anchor.left : align === 'end' ? anchor.right - w : anchor.left + anchor.width / 2 - w / 2;
    left = Math.max(12, Math.min(window.innerWidth - w - 12, left));
    const above = anchor.top - h - 10;
    setPos({ left, top: above >= 12 ? above : anchor.bottom + 10 });
  }, [anchor, align]);

  useEffect(() => {
    const onAnchor = (e: PointerEvent) => e.clientX >= anchor.left && e.clientX <= anchor.right && e.clientY >= anchor.top && e.clientY <= anchor.bottom;
    const down = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && !onAnchor(e) && onClose();
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    // Defer so the click that opened us doesn't close us.
    const t = setTimeout(() => window.addEventListener('pointerdown', down), 0);
    window.addEventListener('keydown', key);
    // Anchored to a spot on screen that a resize moves: just close.
    window.addEventListener('resize', onClose);
    return () => {
      clearTimeout(t);
      window.removeEventListener('pointerdown', down);
      window.removeEventListener('keydown', key);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose, anchor]);

  return (
    <div ref={ref} className="glass popover" style={pos ? pos : { visibility: 'hidden', left: 0, top: 0 }} role="dialog">
      {children}
    </div>
  );
}
