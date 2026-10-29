import { useState } from 'react';
import { Check, Copy } from './icons';

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn ghost sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          prompt('Copy this link', text);
        }
      }}
    >
      {/* A check for a moment: the label stays, so the button keeps its width. */}
      {done ? <Check size={15} /> : <Copy size={15} />} {label}
    </button>
  );
}
