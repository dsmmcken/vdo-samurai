import { useEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import { forgetJoined, parseRoomHash, releaseIdentity, rememberPassword } from '../lib/identity';
import { Home } from './Home';
import { Lobby } from './Lobby';
import { RoomView } from './RoomView';
import { Room } from '../lib/room';

/**
 * Reads the room from the URL. A password in the link (from Create room) is
 * moved into this tab's storage and stripped from the address bar, so the URL
 * you'd copy and share never carries it.
 */
function readTarget() {
  const t = parseRoomHash();
  if (t?.pw) {
    rememberPassword(t.room, t.pw);
    history.replaceState(null, '', `${location.pathname}${location.search}#${new URLSearchParams({ room: t.room })}`);
  }
  return t ? { room: t.room } : null;
}

/** Animates a screen change with the View Transitions API where the browser has it. */
function transition(update: () => void) {
  const start = (document as any).startViewTransition?.bind(document);
  if (!start || matchMedia('(prefers-reduced-motion: reduce)').matches) return update();
  start(() => flushSync(update));
}

export function App() {
  const [target, setTarget] = useState(readTarget);
  const [joined, setJoined] = useState<{ room: Room; pw: string } | null>(null);

  useEffect(() => {
    const onHash = () => transition(() => setTarget(readTarget()));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  if (!target) return <Home />;
  if (!joined) return <Lobby room={target.room} onJoined={(room, pw) => transition(() => setJoined({ room, pw }))} />;
  const { room } = joined;
  const leave = async () => {
    await room.leave();
    releaseIdentity(room.me);
    forgetJoined(room.roomName);
    history.pushState(null, '', location.pathname + location.search);
    transition(() => {
      setJoined(null);
      setTarget(null);
    });
  };
  return <RoomView room={room} onLeave={leave} />;
}
