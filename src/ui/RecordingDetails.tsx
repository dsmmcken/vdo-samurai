import { useState } from 'react';
import type { Room, Snapshot } from '../lib/room';
import { fmtBytes } from '../lib/util';
import { finalCutName } from './AfterTake';
import { Close, Copy } from './icons';

/**
 * Everyone's recorder log for the take (the director sees all; others see
 * their own), then the file-transfer logs (xferlog.ts).
 */
export function RecordingDetails({ room, s, onClose }: { room: Room; s: Snapshot; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const dm = s.directorTake;
  const sections: [string, string[]][] = dm?.reports
    ? Object.entries(dm.reports).map(([id, lines]) => [id === 'render' ? 'Final render' : dm.profiles[id]?.name || 'Guest', lines])
    : s.myReport
      ? [[s.profile.name || 'You', s.myReport]]
      : [];
  for (const { who, lines } of s.transferLogs) sections.push([`Transfers · ${who}`, lines]);
  const text = sections.map(([who, lines]) => `## ${who}\n${lines.join('\n')}`).join('\n\n');
  // The latest final cut stays downloadable here until the next take replaces it.
  const cut = dm && s.render?.state === 'done' && s.render.url ? s.render : null;

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal details" role="dialog" aria-label="Recording details">
        <div className="after-head">
          <h2>Recording details</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <Close size={16} />
          </button>
        </div>
        {cut && (
          <div className="final-cut">
            <span>Final cut{cut.bytes ? ` · ${fmtBytes(cut.bytes)}` : ''}</span>
            <a className="btn primary sm" href={cut.url} download={finalCutName(room, dm!.take.id)} onClick={() => room.markDownloaded()}>
              Download final cut
            </a>
          </div>
        )}
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
                      <div key={i} className={/ERROR|FAILED/.test(l) ? 'bad' : /WARNING|STALLED/.test(l) ? 'warn' : ''}>
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
