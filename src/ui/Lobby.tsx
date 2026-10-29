import { useEffect, useRef, useState } from 'react';
import { claimIdentity, inviteLink, loadProfile, recallPassword, rememberJoined, rememberPassword, saveProfile, wasJoined } from '../lib/identity';
import { openCamera, openVideoTrack } from '../lib/media';
import { Room } from '../lib/room';
import { CopyButton } from './CopyButton';
import { Video } from './Video';
import { Petals } from './Petals';
import { PasswordInput, SecretText, usePasswordCheck } from './Secret';
import { checkMatches, passwordCheck } from '../lib/passcheck';
import { Hint, useFieldIds } from './Hint';
import { Avatar } from './Avatar';
import { MicMeter } from './MicMeter';
import { Cam, CamOff, Mic, MicOff } from './icons';

// Example names for the fields, one per visit: fictional samurai. An even
// mix: two usually women's names, two men's, two used for anyone (Ren, Aoi).
const EXAMPLES = [
  { name: 'Kazehaya Ren', subtitle: 'Swordmaster' },
  { name: 'Hoshino Akane', subtitle: 'Master Archer' },
  { name: 'Mizuhara Daisuke', subtitle: 'Castle Lord' },
  { name: 'Asagiri Aoi', subtitle: 'Captain of the Guard' },
  { name: 'Fujinami Kaito', subtitle: 'Retainer' },
  { name: 'Amano Shizuka', subtitle: 'Strategist' },
];

export function Lobby({ room, check, onJoined }: { room: string; check: string | null; onJoined: (r: Room, pw: string) => void }) {
  // Whoever created the room already has the password; invitees type it here.
  const [known] = useState(() => recallPassword(room));
  const [typedPw, setTypedPw] = useState('');
  const pw = known ?? typedPw;
  const pwCheck = usePasswordCheck(pw);
  // An invite carries a check of the password, so a typo is caught here rather
  // than landing you alone in another room. Old links without one can't tell.
  // Only a failed Join says anything, and editing clears it.
  const checking = known === null && !!check;
  const [pwBad, setPwBad] = useState(false);
  const nameIds = useFieldIds();
  const subIds = useFieldIds();
  const pwIds = useFieldIds();
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
    if (!cam || joining) return;
    if (checking && !checkMatches(await passwordCheck(pw), check)) return setPwBad(true);
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
    if (cam && wasJoined(room) && known !== null) join();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cam]);

  return (
    <>
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
          {/* Same level meter as the tiles: check your mic before joining. */}
          {cam && !micOff && <MicMeter stream={cam} />}
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
          {/* Your lower third, at the same proportions as in the final 1080p video.
              Empty, it shows a dimmed placeholder to invite a name (the final
              cut has no lower third without one). */}
          <div className={`lt-preview ${profile.name.trim() ? '' : 'empty'}`} aria-label="Lower third preview">
            <strong>{profile.name.trim() || 'Your name'}</strong>
            {profile.subtitle.trim() && <span>{profile.subtitle.trim()}</span>}
          </div>
        </div>
        <div className="field">
          <div className="field-head">
            <label htmlFor={nameIds.input}>Full name (optional)</label>
            <Hint id={nameIds.hint} text="Shown as your lower third in the final video. Without a name, there's none." />
          </div>
          <input
            id={nameIds.input}
            value={profile.name}
            onChange={(e) => setProfile({ ...profile, name: e.target.value })}
            placeholder={example.name}
            autoFocus
            aria-describedby={nameIds.hint}
          />
        </div>
        <div className="field">
          <div className="field-head">
            <label htmlFor={subIds.input}>Subtitle (optional)</label>
            <Hint id={subIds.hint} text="Shown under your name in the lower third." />
          </div>
          <input
            id={subIds.input}
            value={profile.subtitle}
            onChange={(e) => setProfile({ ...profile, subtitle: e.target.value })}
            placeholder={example.subtitle}
            aria-describedby={subIds.hint}
          />
        </div>
        {known === null && (
          <div className="field">
            <div className="field-head">
              <label htmlFor={pwIds.input}>Room password</label>
              {!checking && <Hint id={pwIds.hint} text="Leave blank if the room has none." />}
            </div>
            <PasswordInput
              id={pwIds.input}
              aria-describedby={checking ? undefined : pwIds.hint}
              value={typedPw}
              onChange={(e) => {
                setTypedPw(e.target.value);
                setPwBad(false);
              }}
              aria-invalid={pwBad}
            />
            {pwBad && <small className="error">{typedPw.trim() ? "That's not this room's password" : 'This room needs a password'}</small>}
          </div>
        )}
        {known !== null && (
          <div className="invite">
            <span>Invite link</span>
            <code>{inviteLink(room, pwCheck)}</code>
            <CopyButton text={inviteLink(room, pwCheck)} />
            <small>
              {known ? (
                <>
                  Password (share separately): <SecretText value={known} copy />
                </>
              ) : (
                'No password: anyone with the link can join'
              )}
            </small>
          </div>
        )}
        <button className="btn primary" disabled={!cam || joining}>
          <Petals />
          <span className="label">{joining ? 'Joining…' : 'Join room'}</span>
        </button>
      </form>
    </>
  );
}

