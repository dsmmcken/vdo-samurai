import { useState } from 'react';
import { rid, roomSlug } from '../lib/util';
import { browserGaps } from '../lib/identity';
import { Petals } from './Petals';
import { PasswordInput } from './Secret';

const ROOM_RULE = '3–40 characters: letters, numbers, dashes or underscores.';
const PW_RULE = 'At least 8 characters.';

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
    <main className="home">
      <div className="home-card">
        <h1 className="brand">
          <span aria-hidden>⚔</span> VDO Samurai
        </h1>
        <p className="lead">Meet with tiny, low-CPU video. Everyone records full quality on their own machine, and the director’s browser cuts the final video.</p>
        <form onSubmit={create} className="stack" noValidate>
          <label className="field">
            <span>Room name</span>
            <input value={room} onChange={(e) => setRoom(e.target.value.trim())} spellCheck={false} aria-invalid={roomBad} />
            <small className={roomBad ? 'error' : ''}>{roomBad && room.length > 40 ? `Too long. ${ROOM_RULE}` : ROOM_RULE}</small>
          </label>
          <label className="field">
            <span>Password</span>
            <PasswordInput value={pw} onChange={(e) => setPw(e.target.value)} aria-invalid={pwBad} />
            <small className={pwBad ? 'error' : ''}>
              {pwBad ? `${PW_RULE} ${8 - pw.length} more to go.` : `${PW_RULE} It never goes in the invite link; you tell people separately.`}
            </small>
          </label>
          <button className="btn primary">
            <Petals />
            <span className="label">Create room</span>
          </button>
        </form>
        {gaps.length > 0 && <p className="soft-note">VDO Samurai is built for Chrome first. In this browser, {gaps.join(', ')} may not work.</p>}
      </div>
    </main>
  );
}
