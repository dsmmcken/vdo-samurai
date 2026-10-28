import type { Room, Snapshot } from '../lib/room';
import { Avatar } from './Avatar';
import { Pip } from './Pip';
import { endRows } from '../compositor/plan';
import type { PeerId } from '../lib/types';
import { nameOf } from './RoomView';
import { Video } from './Video';

/** The main stage mirrors the final cut's layout, using the low-bitrate live streams. Controls overlay it. */
export function Stage({ room, s, children }: { room: Room; s: Snapshot; children?: React.ReactNode }) {
  const st = s.stage;
  const camOf = (id: PeerId) => (id === s.me ? s.cam : s.peers.get(id)?.cam ?? null);
  const screenOf = (id: PeerId) => (id === s.me ? s.screen : s.peers.get(id)?.screen ?? null);
  const present = (id: PeerId) => id === s.me || s.peers.has(id);
  const off = (id: PeerId) => (id === s.me ? s.camOff : !!s.peers.get(id)?.presence?.camOff);
  const camView = (id: PeerId, className?: string) =>
    off(id) ? <Avatar name={nameOf(s, id)} /> : <Video stream={camOf(id)} mirror={id === s.me} className={className} />;

  let body: React.ReactNode;
  if (!st || (st.kind === 'peer' && !present(st.id))) {
    body = <div className="stage-empty">Click a tile to put it on the main stage.</div>;
  } else if (st.kind === 'end') {
    // Same rows as the final cut (plan.ts endRows): each row fills the width.
    // Only people whose camera is on (everyone, as initials, if nobody's is).
    const on = s.tiles.filter((id) => !off(id));
    const ids = on.length ? on : s.tiles;
    const rows = endRows(ids.length);
    let next = 0;
    body = (
      <div className="end-grid">
        {rows.map((count, r) => (
          <div key={r} className="end-row">
            {ids.slice(next, (next += count)).map((id) => (
              <div key={id} className="end-cell">
                {camView(id)}
              </div>
            ))}
          </div>
        ))}
      </div>
    );
  } else {
    const screen = screenOf(st.id);
    const showScreen = st.view === 'screen' && screen;
    const cam = camOf(st.id);
    body = showScreen ? (
      <>
        <Video stream={screen} fit="contain" className="stage-video" />
        <Pip room={room} s={s} stream={cam} mirror={st.id === s.me} off={off(st.id)} name={nameOf(s, st.id)} />
      </>
    ) : (
      camView(st.id, 'stage-video')
    );
  }
  return (
    <main className="stage" aria-label="Main stage">
      <div className="stage-frame">
        {body}
        {st?.kind === 'peer' && present(st.id) && <span className="glass chip stage-name">{nameOf(s, st.id)}</span>}
        {children}
      </div>
    </main>
  );
}
