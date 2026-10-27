import { useState } from 'react';
import { Copy } from './icons';

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
      <Copy size={15} /> {done ? 'Copied' : label}
    </button>
  );
}
