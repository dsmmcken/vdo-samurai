import { useEffect, useState } from 'react';
import type { Room, Snapshot } from '../lib/room';
import type { RaceRow, Take } from '../lib/types';
import { fmtBytes } from '../lib/util';
import { Close } from './icons';
import { Petals } from './Petals';
import { problemCount } from './RecordingDetails';

const MEDALS = ['🥇', '🥈', '🥉'];

/** How long the panel takes to slide out and puff away. */
const LEAVE_MS = 1000;

/**
 * After the director stops: the upload race for everyone, plus the final cut
 * for the director. It can't be closed while it's the only sign of progress:
 * a guest can close it once their own upload is in, and it leaves by itself
 * once everyone's is. The director's ends with Download or Discard, and leaves
 * once downloaded (Recording details keeps a download until the next take).
 */
export function AfterTake({ room, s, onDetails }: { room: Room; s: Snapshot; onDetails: () => void }) {
  const [hidden, setHidden] = useState<string | null>(null);
  const [leaving, setLeaving] = useState<string | null>(null);
  /** The take the director just downloaded here (a reload of a downloaded take shows nothing). */
  const [saved, setSaved] = useState<string | null>(null);
  const dm = s.directorTake;
  const isDirector = !!dm?.take.stopAt;
  const takeId = isDirector ? dm!.take.id : s.take?.stopAt ? s.take.id : null;
  const rows = s.race ?? [];
  const mineDone = !isDirector && !!s.myUpload?.done;
  const everyoneDone = rows.length > 0 && rows.every((r) => r.done);

  // A moment to see the last "Done", then off to the right.
  useEffect(() => {
    if (!takeId || !mineDone || !everyoneDone || leaving === takeId) return;
    const t = setTimeout(() => setLeaving(takeId), 2500);
    return () => clearTimeout(t);
  }, [takeId, mineDone, everyoneDone, leaving]);
  useEffect(() => {
    if (!takeId || saved !== takeId || leaving === takeId) return;
    const t = setTimeout(() => setLeaving(takeId), 1200);
    return () => clearTimeout(t);
  }, [takeId, saved, leaving]);
  useEffect(() => {
    if (!leaving) return;
    const t = setTimeout(() => setHidden(leaving), LEAVE_MS);
    return () => clearTimeout(t);
  }, [leaving]);

  if (!takeId || hidden === takeId) return null;
  if (isDirector && dm!.downloaded && saved !== takeId) return null;
  // Only uploaders see the race. A director who discarded their take sees nothing.
  if (!isDirector && (s.take?.director === s.me || (!rows.length && !s.myUpload))) return null;

  const r = s.render;
  const title = !isDirector
    ? s.myUpload?.done
      ? 'Upload complete'
      : 'Uploading to the Shōgun (director)'
    : r?.state === 'done'
      ? dm!.downloaded
        ? 'Saved'
        : 'Final cut ready'
      : r?.state === 'rendering'
        ? 'Rendering the final cut'
        : rows.length
          ? 'Collecting recordings'
          : 'Preparing';

  const gone = leaving === takeId;

  return (
    <>
      <aside className={`glass panel after ${gone ? 'leaving' : ''}`} aria-label={title}>
        <div className="after-head">
          <h2>{title}</h2>
          {s.transferLogs.length > 0 && problemCount(s) === 0 && (
            <button className="text-link" onClick={onDetails}>
              Transfer log
            </button>
          )}
          {mineDone && (
            <button className="icon-btn" onClick={() => setLeaving(takeId)} aria-label="Close" title="Close">
              <Close size={16} />
            </button>
          )}
        </div>

        {!isDirector && s.myUpload?.done && <p className="safe">Your recording is safely with the Shōgun (director). You can close this tab.</p>}
        {!isDirector && s.myUpload && !s.myUpload.done && <p className="muted">Keep this tab open until your upload finishes.</p>}

        {rows.length > 0 && !(isDirector && r?.state === 'done') && <Race rows={rows} me={s.me} />}

        {isDirector && <DirectorFinish room={room} s={s} onSaved={() => setSaved(takeId)} />}
        {problemCount(s) > 0 && (
          <button className="problems" onClick={onDetails}>
            {problemCount(s)} recording {problemCount(s) === 1 ? 'problem' : 'problems'} · Details
          </button>
        )}
      </aside>
      {gone && (
        <div className="after-puff" aria-hidden>
          {PUFFS.map(([x, y, size], i) => (
            <span
              key={i}
              style={
                {
                  '--dx': `${x}px`,
                  '--dy': `${y}px`,
                  width: size,
                  height: size,
                  animationDelay: `${0.25 + i * 0.04}s`,
                } as React.CSSProperties
              }
            />
          ))}
        </div>
      )}
    </>
  );
}

/** The puff where the panel leaves: soft clouds drifting out from the edge (dx, dy, size). */
const PUFFS: [number, number, number][] = [
  [-30, -18, 54],
  [-10, 14, 64],
  [-46, 10, 40],
  [6, -26, 44],
  [-24, 30, 36],
];

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
            <span className="amt">
              {r.done ? 'Done' : r.announced ? `${Math.floor(frac(r) * 100)}% · ${fmtBytes(r.total)}${r.rate ? ` · ${(r.rate / 1024 ** 2).toFixed(1)} MB/s` : ''}` : 'Waiting'}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function frac(r: { received: number; total: number; done: boolean }) {
  return r.done ? 1 : r.total ? r.received / r.total : 0;
}

function DirectorFinish({ room, s, onSaved }: { room: Room; s: Snapshot; onSaved: () => void }) {
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
        <a
          className="btn primary"
          href={r.url}
          download={finalCutName(dm.take)}
          onClick={() => {
            room.markDownloaded();
            onSaved();
          }}
        >
          <Petals />
          <span className="label">{`Download MP4${r.bytes ? ` · ${fmtBytes(r.bytes)}` : ''}`}</span>
        </a>
        {!dm.downloaded && discard}
      </div>
    </div>
  );
}

/** When the take started, in local time: "2026-10-23 15-15-02.mp4". */
export function finalCutName(take: Take) {
  const d = new Date(take.startAt);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}.mp4`;
}
