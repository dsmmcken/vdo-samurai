import { useState } from 'react';
import { rid, roomSlug } from '../lib/util';
import { browserGaps } from '../lib/identity';
import { Petals } from './Petals';
import { PasswordInput } from './Secret';
import { Landing } from './Landing';

const ROOM_RULE = '3–40 letters, numbers, - or _';
const PW_RULE = '8+ characters';

export function Home() {
  const [room, setRoom] = useState(roomSlug);
  const [pw, setPw] = useState(() => rid(12));
  const [tried, setTried] = useState(false);
  const roomOk = /^[\w-]{3,40}$/.test(room);
  const pwOk = pw.length >= 8;
  const gaps = browserGaps();

  const create = (e: React.FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (roomOk && pwOk) location.hash = new URLSearchParams({ room, pw }).toString();
  };

  // Rules show as hints; they turn into errors once you've typed something invalid or tried to submit.
  const roomBad = !roomOk && (tried || room.length > 0);
  const pwBad = !pwOk && (tried || pw.length > 0);

  return (
    <Landing>
      <div className="home-card">
        <form onSubmit={create} className="stack" noValidate>
          <label className="field">
            <span>Room name</span>
            <input value={room} onChange={(e) => setRoom(e.target.value.trim())} spellCheck={false} aria-invalid={roomBad} />
            <small className={roomBad ? 'error' : ''}>{roomBad && room.length > 40 ? `Too long: ${ROOM_RULE}` : ROOM_RULE}</small>
          </label>
          <label className="field">
            <span>Password</span>
            <PasswordInput value={pw} onChange={(e) => setPw(e.target.value)} aria-invalid={pwBad} />
            <small className={pwBad ? 'error' : ''}>{pwBad ? `${PW_RULE} (${8 - pw.length} more)` : `${PW_RULE}, not in the invite link`}</small>
          </label>
          <button className="btn primary">
            <Petals />
            <span className="label">Create room</span>
          </button>
        </form>
        {gaps.length > 0 && <p className="soft-note">Best in Chrome: {gaps.join(', ')} may not work here.</p>}
      </div>
    </Landing>
  );
}
