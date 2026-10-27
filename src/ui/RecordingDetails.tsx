import { useState } from 'react';
import type { Snapshot } from '../lib/room';
import { Close, Copy } from './icons';

/** Everyone's recorder log for the take (the director sees all; others see their own). */
export function RecordingDetails({ s, onClose }: { s: Snapshot; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const dm = s.directorTake;
  const sections: [string, string[]][] = dm?.reports
    ? Object.entries(dm.reports).map(([id, lines]) => [id === 'render' ? 'Final render' : dm.profiles[id]?.name ?? id, lines])
    : s.myReport
      ? [[s.profile.name || 'You', s.myReport]]
      : [];
  const text = sections.map(([who, lines]) => `## ${who}\n${lines.join('\n')}`).join('\n\n');

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal details" role="dialog" aria-label="Recording details">
        <div className="after-head">
          <h2>Recording details</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <Close size={16} />
          </button>
        </div>
        {sections.length === 0 ? (
          <p className="muted">Nothing recorded yet. Details appear here once a take starts.</p>
        ) : (
          <>
            <div className="details-body">
              {sections.map(([who, lines]) => (
                <section key={who}>
                  <h3>{who}</h3>
                  <pre>
                    {lines.map((l, i) => (
                      <div key={i} className={/ERROR/.test(l) ? 'bad' : /WARNING/.test(l) ? 'warn' : ''}>
                        {l}
                      </div>
                    ))}
                  </pre>
                </section>
              ))}
            </div>
            <div className="row end">
              <button
                className="btn ghost sm"
                onClick={async () => {
                  await navigator.clipboard.writeText(text).catch(() => prompt('Copy the details', text));
                  setCopied(true);
                }}
              >
                <Copy size={15} /> {copied ? 'Copied' : 'Copy all'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** Lines that need attention across a snapshot's reports. */
export function problemCount(s: Snapshot) {
  const all = s.directorTake?.reports ? Object.values(s.directorTake.reports).flat() : s.myReport ?? [];
  return all.filter((l) => /ERROR|WARNING/.test(l)).length;
}
