import { useState } from 'react';
import { rid, roomSlug } from '../lib/util';
import { browserGaps } from '../lib/identity';
import { passwordCheck } from '../lib/passcheck';
import { Petals } from './Petals';
import { PasswordInput } from './Secret';
import { Hint, useFieldIds } from './Hint';

const ROOM_RULE = '3–40 letters, numbers, - or _';

export function Home() {
  const [room, setRoom] = useState(roomSlug);
  const [pw, setPw] = useState(() => rid(12));
  const [tried, setTried] = useState(false);
  const roomOk = /^[\w-]{3,40}$/.test(room);
  const gaps = browserGaps();
  const roomIds = useFieldIds();
  const pwIds = useFieldIds();

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (!roomOk) return;
    const check = await passwordCheck(pw);
    location.hash = new URLSearchParams({ room, ...(check && { hash: check }), pw }).toString();
  };

  // The rule sits behind the (?); it shows as an error once you've typed something invalid or tried to submit.
  const roomBad = !roomOk && (tried || room.length > 0);

  return (
    <>
      <div className="home-stack">
        <div className="home-card">
          <form onSubmit={create} className="stack" noValidate>
            <div className="field">
              <div className="field-head">
                <label htmlFor={roomIds.input}>Room name</label>
                <Hint id={roomIds.hint} text={ROOM_RULE} />
              </div>
              <input id={roomIds.input} value={room} onChange={(e) => setRoom(e.target.value.trim())} spellCheck={false} aria-invalid={roomBad} aria-describedby={roomIds.hint} />
              {roomBad && <small className="error">{room.length > 40 ? `Too long: ${ROOM_RULE}` : ROOM_RULE}</small>}
            </div>
            <div className="field">
              <div className="field-head">
                <label htmlFor={pwIds.input}>Password (optional)</label>
                <Hint id={pwIds.hint} text="Use a password to keep meetings secure and private." />
              </div>
              <PasswordInput id={pwIds.input} value={pw} onChange={(e) => setPw(e.target.value)} aria-describedby={pwIds.hint} />
            </div>
            <button className="btn primary">
              <Petals />
              <span className="label">Create or join room</span>
            </button>
          </form>
          {gaps.length > 0 && <p className="soft-note">Best in Chrome: {gaps.join(', ')} may not work here.</p>}
        </div>
        <p className="tagline">Records locally, sends to host over p2p. Host renders.</p>
      </div>
    </>
  );
}
