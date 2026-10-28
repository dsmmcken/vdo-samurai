import { useEffect, useRef, useState } from 'react';
import type { Snapshot } from '../lib/room';
import { musicMutedPref, setMusicMutedPref, WaitingMusic as Player } from '../lib/music';
import { MusicNote, MusicOff } from './icons';

const ALONE_DELAY_MS = 5000;

/**
 * Once you've been the only one in the room for 5 seconds, waiting music fades
 * in, with a chip in the top right to mute it. It fades out as soon as anyone
 * joins, and stops for good once anyone presses Record.
 */
export function WaitingMusic({ s }: { s: Snapshot }) {
  const player = useRef<Player | null>(null);
  const [on, setOn] = useState(false);
  const [muted, setMuted] = useState(musicMutedPref);
  // Count only once we're in the room's signaling, so people already there
  // have had a chance to show up before we decide you're alone. And once anyone
  // has hit Record here (even recording solo), it stays off for the session.
  const recordedHere = useRef(false);
  if (s.take) recordedHere.current = true;
  const alone = s.meshStatus === 'connected' && s.peers.size === 0 && !recordedHere.current;

  useEffect(() => {
    if (!alone) {
      if (on) {
        // Recording starts its recorders straight away: get out of the mic fast.
        player.current?.stop(recordedHere.current);
        setOn(false);
      }
      return;
    }
    const t = setTimeout(() => {
      player.current ??= new Player();
      player.current.setMuted(muted);
      player.current.setSink(s.current.speaker);
      player.current.play();
      setOn(true);
    }, ALONE_DELAY_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alone]);

  useEffect(() => player.current?.setSink(s.current.speaker), [s.current.speaker]);
  useEffect(() => () => player.current?.dispose(), []);

  if (!on) return null;
  const toggle = () => {
    const next = !muted;
    setMuted(next);
    setMusicMutedPref(next);
    player.current?.setMuted(next);
    if (!next) player.current?.play(); // also resumes audio if the browser held it back
  };
  return (
    <button className={`glass chip music-chip ${muted ? 'muted' : ''}`} onClick={toggle} title={muted ? 'Unmute waiting music' : 'Mute waiting music'} aria-pressed={muted}>
      {muted ? <MusicOff size={16} /> : <MusicNote size={16} />} Waiting music
    </button>
  );
}
