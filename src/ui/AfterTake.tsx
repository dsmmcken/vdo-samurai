import { useState } from 'react';
import type { Room, Snapshot } from '../lib/room';
import type { RaceRow } from '../lib/types';
import { fmtBytes } from '../lib/util';
import { Close } from './icons';
import { Petals } from './Petals';
import { problemCount } from './RecordingDetails';

const MEDALS = ['🥇', '🥈', '🥉'];

/** After the director stops: the upload race for everyone, plus the final cut for the director. */
export function AfterTake({ room, s, onDetails }: { room: Room; s: Snapshot; onDetails: () => void }) {
  const [hidden, setHidden] = useState<string | null>(null);
  const dm = s.directorTake;
  const isDirector = !!dm?.take.stopAt;
  const takeId = isDirector ? dm!.take.id : s.take?.stopAt ? s.take.id : null;
  if (!takeId || hidden === takeId) return null;
  const rows = s.race ?? [];
  // Only uploaders see the race. A director who discarded their take sees nothing.
  if (!isDirector && (s.take?.director === s.me || (!rows.length && !s.myUpload))) return null;

  const r = s.render;
  const title = !isDirector
    ? s.myUpload?.done
      ? 'Upload complete'
      : 'Uploading to the director'
    : r?.state === 'done'
      ? dm!.downloaded
        ? 'Saved'
        : 'Final cut ready'
      : r?.state === 'rendering'
        ? 'Rendering the final cut'
        : rows.length
          ? 'Collecting recordings'
          : 'Preparing';

  // Closing a downloaded take also clears it from this browser.
  const close = () => (isDirector && dm?.downloaded ? room.discardTake() : setHidden(takeId));

  return (
    <aside className="glass panel after" aria-label={title}>
      <div className="after-head">
        <h2>{title}</h2>
        <button className="icon-btn" onClick={close} aria-label="Close" title={isDirector && dm?.downloaded ? 'Close and clear storage' : 'Hide'}>
          <Close size={16} />
        </button>
      </div>

      {!isDirector && s.myUpload?.done && <p className="safe">Your recording is safely with the director. You can close this tab.</p>}
      {!isDirector && s.myUpload && !s.myUpload.done && <p className="muted">Keep this tab open until your upload finishes.</p>}

      {rows.length > 0 && !(isDirector && r?.state === 'done') && <Race rows={rows} me={s.me} />}

      {isDirector && <DirectorFinish room={room} s={s} />}
      {problemCount(s) > 0 && (
        <button className="problems" onClick={onDetails}>
          {problemCount(s)} recording {problemCount(s) === 1 ? 'problem' : 'problems'} · Details
        </button>
      )}
    </aside>
  );
}

function Race({ rows, me }: { rows: RaceRow[]; me: string }) {
  const finished = rows.filter((r) => r.done).sort((a, b) => (a.finishedAt ?? 0) - (b.finishedAt ?? 0));
  const running = rows.filter((r) => !r.done).sort((a, b) => frac(b) - frac(a));
  return (
    <ol className="race">
      {[...finished, ...running].map((r) => {
        const place = finished.indexOf(r);
        return (
          <li key={r.peer} className={r.peer === me ? 'me' : ''}>
            <span className="place">{place >= 0 ? MEDALS[place] ?? '✓' : ''}</span>
            <span className="who">{r.peer === me ? `${r.name} (you)` : r.name}</span>
            <span className="bar">
              <span style={{ width: `${Math.round(frac(r) * 100)}%` }} className={r.done ? 'done' : ''} />
            </span>
            <span className="amt">{r.done ? 'Done' : r.announced ? `${Math.floor(frac(r) * 100)}% · ${fmtBytes(r.total)}` : 'Waiting'}</span>
          </li>
        );
      })}
    </ol>
  );
}

function frac(r: { received: number; total: number; done: boolean }) {
  return r.done ? 1 : r.total ? r.received / r.total : 0;
}

function DirectorFinish({ room, s }: { room: Room; s: Snapshot }) {
  const r = s.render;
  const dm = s.directorTake!;
  const waiting = (s.race ?? []).filter((x) => !x.done).length;
  const discard = (
    <button className="btn ghost sm danger" onClick={() => confirm('Discard this take for good?') && room.discardTake()}>
      Discard take
    </button>
  );

  if (!r || r.state === 'waiting')
    return (
      <div className="render">
        <p className="muted">{waiting ? `Rendering starts when ${waiting === 1 ? 'the last upload finishes' : `${waiting} uploads finish`}.` : 'Starting the render…'}</p>
        <div className="row">
          {waiting > 0 && (
            <button className="btn ghost sm" onClick={() => confirm("Render now? Anyone who hasn't finished uploading will be left out.") && room.startRender()}>
              Render with what's here
            </button>
          )}
          {discard}
        </div>
      </div>
    );
  if (r.state === 'rendering')
    return (
      <div className="render">
        <div className="progress">
          <span style={{ width: `${Math.round(r.progress * 100)}%` }} />
        </div>
        <p className="muted">
          {Math.floor(r.progress * 100)}%{r.speed ? ` · ${r.speed.toFixed(1)}× real time` : ''} · keep this tab open
        </p>
      </div>
    );
  if (r.state === 'error')
    return (
      <div className="render">
        <p className="bad">Rendering failed: {r.error}</p>
        <div className="row">
          <button className="btn primary sm" onClick={() => room.startRender()}>
            Try again
          </button>
          {discard}
        </div>
      </div>
    );
  return (
    <div className="render">
      <video className="final-preview" src={r.url} controls />
      <div className="row">
        <a className="btn primary" href={r.url} download={`${room.roomName}-${dm.take.id}.mp4`} onClick={() => room.markDownloaded()}>
          <Petals />
          <span className="label">{dm.downloaded ? 'Download again' : `Download MP4${r.bytes ? ` · ${fmtBytes(r.bytes)}` : ''}`}</span>
        </a>
        {dm.downloaded ? (
          <button className="btn ghost" onClick={() => room.discardTake()}>
            Clear and close
          </button>
        ) : (
          discard
        )}
      </div>
    </div>
  );
}
