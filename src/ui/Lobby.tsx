import { useEffect, useRef, useState } from 'react';
import { claimIdentity, inviteLink, loadProfile, recallPassword, rememberJoined, rememberPassword, saveProfile, wasJoined } from '../lib/identity';
import { openCamera, openVideoTrack } from '../lib/media';
import { Room } from '../lib/room';
import { CopyButton } from './CopyButton';
import { Video } from './Video';
import { Petals } from './Petals';
import { PasswordInput, SecretText } from './Secret';
import { Landing } from './Landing';
import { Avatar } from './Avatar';
import { Cam, CamOff, Mic, MicOff } from './icons';

// Example names for the fields: one famous samurai per visit.
const EXAMPLES = [
  { name: 'Miyamoto Musashi', subtitle: 'Rōnin, Niten Ichi-ryū' },
  { name: 'Tomoe Gozen', subtitle: 'Onna-musha, Minamoto clan' },
  { name: 'Date Masamune', subtitle: 'Daimyō of Sendai' },
  { name: 'Sanada Yukimura', subtitle: 'General, Sanada clan' },
  { name: 'Uesugi Kenshin', subtitle: 'Dragon of Echigo' },
  { name: 'Honda Tadakatsu', subtitle: 'General, Tokugawa clan' },
];

export function Lobby({ room, onJoined }: { room: string; onJoined: (r: Room, pw: string) => void }) {
  // Whoever created the room already has the password; invitees type it here.
  const [known] = useState(() => recallPassword(room));
  const [typedPw, setTypedPw] = useState('');
  const pw = known ?? typedPw;
  const [profile, setProfile] = useState(loadProfile);
  const [example] = useState(() => EXAMPLES[Math.floor(Math.random() * EXAMPLES.length)]);
  const [cam, setCam] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const camRef = useRef<MediaStream | null>(null);
  const handedOff = useRef(false); // the camera now belongs to the room
  // Join muted and/or with the camera off. Camera off releases the camera here
  // too (light off); turning it back on reopens it.
  const [micOff, setMicOff] = useState(false);
  const [camOff, setCamOff] = useState(false);
  const [videoKey, setVideoKey] = useState(0);
  const toggleMic = () => {
    const next = !micOff;
    cam?.getAudioTracks().forEach((t) => (t.enabled = !next));
    setMicOff(next);
  };
  const toggleCam = async () => {
    if (!cam) return;
    if (!camOff) {
      for (const t of cam.getVideoTracks()) {
        cam.removeTrack(t);
        t.stop();
      }
      setCamOff(true);
    } else {
      try {
        cam.addTrack(await openVideoTrack());
        setVideoKey((k) => k + 1); // new <video> for the new track
        setCamOff(false);
      } catch (e) {
        setError(`Couldn't turn the camera on: ${(e as Error).message}`);
      }
    }
  };

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
    r.start(cam, { micMuted: micOff, camOff });
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
          {cam ? (
            camOff ? (
              <Avatar name={profile.name.trim() || '?'} />
            ) : (
              <Video key={videoKey} stream={cam} mirror />
            )
          ) : (
            <div className="preview-empty">{error ?? 'Starting camera…'}</div>
          )}
          {cam && (
            <div className="preview-controls">
              <button type="button" className={`glass round ${micOff ? 'off' : ''}`} onClick={toggleMic} aria-label={micOff ? 'Unmute' : 'Mute'} title={micOff ? 'Join muted (click to unmute)' : 'Mute'}>
                {micOff ? <MicOff size={18} /> : <Mic size={18} />}
              </button>
              <button type="button" className={`glass round ${camOff ? 'off' : ''}`} onClick={toggleCam} aria-label={camOff ? 'Turn camera on' : 'Turn camera off'} title={camOff ? 'Join with camera off (click to turn on)' : 'Turn camera off'}>
                {camOff ? <CamOff size={18} /> : <Cam size={18} />}
              </button>
            </div>
          )}
          {/* Your lower third, at the same proportions as in the final 1080p video. */}
          <div className="lt-preview" aria-label="Lower third preview">
            <strong>{profile.name.trim() || 'Your name'}</strong>
            {profile.subtitle.trim() && <span>{profile.subtitle.trim()}</span>}
          </div>
        </div>
        <label className="field">
          <span>Full name</span>
          <input value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} placeholder={example.name} autoFocus />
        </label>
        <label className="field">
          <span>Subtitle</span>
          <input value={profile.subtitle} onChange={(e) => setProfile({ ...profile, subtitle: e.target.value })} placeholder={example.subtitle} />
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

