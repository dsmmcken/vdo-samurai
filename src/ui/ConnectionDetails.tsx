import { useEffect, useState } from 'react';
import type { Room, Snapshot } from '../lib/room';
import type { PeerId } from '../lib/types';
import { Check, Close, Copy } from './icons';
import { nameOf } from './RoomView';

/**
 * One person's connection details, for working out why someone can't see
 * someone (or their screen): our link to them as we see it, then their whole
 * session as they see it, asked for over that link.
 */
export function ConnectionDetails({ room, s, id, onClose }: { room: Room; s: Snapshot; id: PeerId; onClose: () => void }) {
  const me = id === s.me;
  const name = nameOf(s, id);
  const [theirs, setTheirs] = useState<{ lines?: string[]; error?: string } | null>(null);
  const [ours, setOurs] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);
  const [asked, setAsked] = useState(0);

  useEffect(() => {
    let live = true;
    setTheirs(null);
    setCopied(false);
    if (!me) setOurs(room.linkDetails(id));
    room.requestDetails(id).then(
      (lines) => live && setTheirs({ lines }),
      (e: Error) => live && setTheirs({ error: e.message }),
    );
    return () => void (live = false);
  }, [id, asked]);

  const sections: [string, string[]][] = [];
  if (!me) sections.push([`Your connection to ${name}`, ours]);
  if (theirs?.lines) sections.push([me ? 'Your session' : `${name}'s session`, theirs.lines]);
  const text = sections.map(([who, lines]) => `## ${who}\n${lines.join('\n')}`).join('\n\n');

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal details" role="dialog" aria-label="Connection details">
        <div className="after-head">
          <h2>Connection details · {me ? 'you' : name}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <Close size={16} />
          </button>
        </div>
        <div className="details-body">
          {sections.map(([who, lines]) => (
            <section key={who}>
              <h3>{who}</h3>
              <pre>
                {lines.map((l, i) => (
                  <div key={i} className={/NOT ARRIVING|failed|missing|stuck|not connected|no way to reach|could not/i.test(l) ? 'bad' : /disconnected|repair|rebuild|relay|unstick|isn't arriving/i.test(l) ? 'warn' : ''}>
                    {l || ' '}
                  </div>
                ))}
              </pre>
            </section>
          ))}
          {!theirs && <p className="muted">Asking {me ? 'this tab' : name} for {me ? 'its' : 'their'} details…</p>}
          {theirs?.error && <p className="muted">Couldn't get {name}'s side: {theirs.error}</p>}
        </div>
        <div className="row end">
          {!me && (
            <button className="btn ghost sm" onClick={() => (room.reconnect(id), setTimeout(() => setAsked((n) => n + 1), 3000))} title={`Rebuild the connection to ${name}`}>
              Reconnect
            </button>
          )}
          <button className="btn ghost sm" onClick={() => setAsked((n) => n + 1)}>
            Refresh
          </button>
          <button
            className="btn ghost sm"
            disabled={!sections.length}
            onClick={async () => {
              await navigator.clipboard.writeText(text).catch(() => prompt('Copy the details', text));
              setCopied(true);
            }}
          >
            {copied ? <Check size={15} /> : <Copy size={15} />} Copy all
          </button>
        </div>
      </div>
    </div>
  );
}
