import type { Snapshot } from '../lib/room';
import type { PeerId } from '../lib/types';
import { nameOf } from './RoomView';
import { Video } from './Video';

/** The main stage mirrors the final cut's layout, using the low-bitrate live streams. Controls overlay it. */
export function Stage({ s, children }: { s: Snapshot; children?: React.ReactNode }) {
  const st = s.stage;
  const camOf = (id: PeerId) => (id === s.me ? s.cam : s.peers.get(id)?.cam ?? null);
  const screenOf = (id: PeerId) => (id === s.me ? s.screen : s.peers.get(id)?.screen ?? null);
  const present = (id: PeerId) => id === s.me || s.peers.has(id);

  let body: React.ReactNode;
  if (!st || (st.kind === 'peer' && !present(st.id))) {
    body = <div className="stage-empty">Click a tile to put it on the main stage.</div>;
  } else if (st.kind === 'end') {
    const ids = s.tiles;
    const cols = Math.ceil(Math.sqrt(ids.length));
    const rows = Math.ceil(ids.length / cols);
    body = (
      <div className="end-grid" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)`, gridTemplateRows: `repeat(${rows}, 1fr)` }}>
        {ids.map((id) => (
          <div key={id} className="end-cell">
            <Video stream={camOf(id)} mirror={id === s.me} />
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
        <div className="pip">
          <Video stream={cam} mirror={st.id === s.me} />
        </div>
      </>
    ) : (
      <Video stream={cam} mirror={st.id === s.me} className="stage-video" />
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
