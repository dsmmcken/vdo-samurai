import { useEffect, useRef, useState } from 'react';
import { claimIdentity, inviteLink, loadProfile, recallPassword, rememberJoined, rememberPassword, saveProfile, wasJoined } from '../lib/identity';
import { openCamera } from '../lib/media';
import { Room } from '../lib/room';
import { CopyButton } from './CopyButton';
import { Video } from './Video';
import { Petals } from './Petals';
import { PasswordInput, SecretText } from './Secret';
import { Landing } from './Landing';

export function Lobby({ room, onJoined }: { room: string; onJoined: (r: Room, pw: string) => void }) {
  // Whoever created the room already has the password; invitees type it here.
  const [known] = useState(() => recallPassword(room));
  const [typedPw, setTypedPw] = useState('');
  const pw = known ?? typedPw;
  const [profile, setProfile] = useState(loadProfile);
  const [cam, setCam] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const camRef = useRef<MediaStream | null>(null);
  const handedOff = useRef(false); // the camera now belongs to the room

  useEffect(() => {
    let cancelled = false;
    openCamera()
      .then((s) => {
        if (cancelled) return s.getTracks().forEach((t) => t.stop());
        camRef.current = s;
        setCam(s);
      })
      .catch((e) => setError(`Camera or microphone unavailable: ${e.message || e.name}`));
    return () => {
      cancelled = true;
      // Leaving the lobby without joining (e.g. browser back): release the camera.
      if (!handedOff.current) camRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const join = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!cam || !profile.name.trim() || joining) return;
    setJoining(true);
    const p = { name: profile.name.trim(), subtitle: profile.subtitle.trim() };
    saveProfile(p);
    rememberJoined(room);
    rememberPassword(room, pw);
    const id = await claimIdentity(room);
    const r = new Room(id, room, pw, p);
    handedOff.current = true;
    r.start(cam);
    (window as any).samurai = r; // handy from the devtools console
    onJoined(r, pw);
  };

  // A reload (or a crash) mid-session shouldn't park you in the lobby: rejoin
  // as soon as the camera is back. The director's take resumes from storage.
  useEffect(() => {
    if (cam && wasJoined(room) && profile.name.trim() && known !== null) join();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cam]);

  return (
    <Landing>
      <form className="home-card lobby" onSubmit={join}>
        <h1 className="room-title">{room}</h1>
        <div className="preview">
          {cam ? <Video stream={cam} mirror /> : <div className="preview-empty">{error ?? 'Starting camera…'}</div>}
          {/* Your lower third, at the same proportions as in the final 1080p video. */}
          <div className="lt-preview" aria-label="Lower third preview">
            <strong>{profile.name.trim() || 'Your name'}</strong>
            {profile.subtitle.trim() && <span>{profile.subtitle.trim()}</span>}
          </div>
        </div>
        <label className="field">
          <span>Full name</span>
          <input value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} placeholder="Ada Lovelace" autoFocus />
        </label>
        <label className="field">
          <span>Subtitle</span>
          <input value={profile.subtitle} onChange={(e) => setProfile({ ...profile, subtitle: e.target.value })} placeholder="Analyst, Babbage & Co." />
          <small>Your lower third in the final video</small>
        </label>
        {known === null && (
          <label className="field">
            <span>Room password</span>
            <PasswordInput value={typedPw} onChange={(e) => setTypedPw(e.target.value)} />
            <small>From whoever invited you; blank if the room has none</small>
          </label>
        )}
        {known !== null && (
          <div className="invite">
            <span>Invite link</span>
            <code>{inviteLink(room)}</code>
            <CopyButton text={inviteLink(room)} />
            <small>
              {known ? (
                <>
                  Password, shared separately: <SecretText value={known} />
                </>
              ) : (
                'No password: anyone with the link can join'
              )}
            </small>
          </div>
        )}
        <button className="btn primary" disabled={!cam || !profile.name.trim() || joining}>
          <Petals />
          <span className="label">{joining ? 'Joining…' : 'Join room'}</span>
        </button>
      </form>
    </Landing>
  );
}

