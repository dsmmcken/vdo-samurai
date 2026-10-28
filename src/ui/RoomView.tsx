import { useEffect, useState, useSyncExternalStore } from 'react';
import { inviteLink, saveProfile } from '../lib/identity';
import type { Room, Snapshot } from '../lib/room';
import type { DeviceKind } from '../lib/media';
import type { PeerId } from '../lib/types';
import { fmtClock } from '../lib/util';
import { AfterTake } from './AfterTake';
import { Countdown } from './Countdown';
import { Cam, CamOff, Check, Chevron, Copy, Dot, Info, Leave, Speaker, Mic, MicOff, More, Pencil, Screen, Square, User } from './icons';
import { Popover } from './Popover';
import { ProfileForm } from './ProfileForm';
import { Stage } from './Stage';
import { TileStrip } from './TileStrip';
import { RemoteAudio } from './Video';
import { RecordingDetails } from './RecordingDetails';

export function RoomView({ room, onLeave }: { room: Room; onLeave: () => void }) {
  const s = useSyncExternalStore(room.subscribe, room.getSnapshot);
  const [edit, setEdit] = useState<{ at: DOMRect; id: PeerId } | null>(null);
  const [menuAt, setMenuAt] = useState<DOMRect | null>(null);
  const [details, setDetails] = useState(false);
  const iAmDirector = s.director === s.me;

  const record = async () => {
    const dm = s.directorTake;
    if (dm && !dm.downloaded && !confirm("The last take's final cut hasn't been downloaded. Discard it and record a new take?")) return;
    if (dm) await room.discardTake();
    room.startRecording();
  };

  return (
    <div className="room">
      <Stage room={room} s={s}>
        <RecIndicator s={s} />
        {!s.director && !s.take && <div className="glass hint">No director yet. Claim it on your tile.</div>}

        <div className="tray">
          <button className={`glass round ${s.micMuted ? 'off' : ''}`} onClick={() => room.toggleMic()} title={s.micMuted ? 'Unmute' : 'Mute'} aria-label={s.micMuted ? 'Unmute' : 'Mute'}>
            {s.micMuted ? <MicOff size={20} /> : <Mic size={20} />}
          </button>
          <button className={`glass round ${s.camOff ? 'off' : ''}`} onClick={() => room.toggleCam()} title={s.camOff ? 'Turn camera on' : 'Turn camera off'} aria-label={s.camOff ? 'Turn camera on' : 'Turn camera off'}>
            {s.camOff ? <CamOff size={20} /> : <Cam size={20} />}
          </button>
          <button
            className={`glass round ${s.screen ? 'on' : ''}`}
            onClick={() => room.toggleScreen()}
            title={s.screen ? 'Stop sharing your screen' : 'Share your screen'}
            aria-label={s.screen ? 'Stop sharing' : 'Share screen'}
          >
            <Screen size={20} />
          </button>
          {iAmDirector &&
            (s.recording ? (
              <button className="glass round rec on" onClick={() => room.stopRecording()} title="Stop recording" aria-label="Stop">
                <Square size={22} />
              </button>
            ) : (
              <button className="glass round rec" onClick={record} title="Record" aria-label="Record">
                <Dot size={26} />
              </button>
            ))}
          <ViewToggle room={room} s={s} />
          <button className="glass round" onClick={(e) => setMenuAt(e.currentTarget.getBoundingClientRect())} title="More" aria-label="More">
            <More size={20} />
          </button>
        </div>
      </Stage>

      <TileStrip room={room} s={s} onEditProfile={(at, id) => setEdit({ at, id })} />

      {edit && (
        <Popover anchor={edit.at} onClose={() => setEdit(null)}>
          <ProfileForm
            key={edit.id}
            initial={edit.id === s.me ? s.profile : s.peers.get(edit.id)?.presence?.profile ?? { name: '', subtitle: '' }}
            onCancel={() => setEdit(null)}
            onSave={(p) => {
              if (edit.id === s.me) saveProfile(p);
              room.setProfileOf(edit.id, p);
              setEdit(null);
            }}
          />
        </Popover>
      )}
      {menuAt && (
        <Popover anchor={menuAt} onClose={() => setMenuAt(null)} align="end">
          <RoomMenu
            room={room}
            s={s}
            close={() => setMenuAt(null)}
            onEdit={() => (setEdit({ at: menuAt, id: s.me }), setMenuAt(null))}
            onDetails={() => (setDetails(true), setMenuAt(null))}
            onLeave={() => {
              const busy = s.recording || (s.myUpload && !s.myUpload.done);
              if (busy && !confirm(s.recording ? 'A take is recording. Leave anyway?' : "Your upload isn't finished. Leave anyway? It resumes if you come back.")) return;
              onLeave();
            }}
          />
        </Popover>
      )}

      <Countdown startLocal={s.recording ? s.takeStartLocal : null} />
      <AfterTake room={room} s={s} onDetails={() => setDetails(true)} />
      {details && <RecordingDetails s={s} onClose={() => setDetails(false)} />}
      {s.notice && <div className="glass toast">{s.notice}</div>}

      {[...s.peers.values()].map((p) => (
        <RemoteAudio key={p.id} stream={p.cam} sinkId={s.current.speaker} />
      ))}
    </div>
  );
}

/** Camera / screen for whoever is on stage, when they have a screen share. */
function ViewToggle({ room, s }: { room: Room; s: Snapshot }) {
  const st = s.stage;
  if (st?.kind !== 'peer') return null;
  const hasScreen = st.id === s.me ? !!s.screen : !!s.peers.get(st.id)?.screen;
  if (!hasScreen || (s.recording && s.director !== s.me)) return null;
  const set = (view: 'cam' | 'screen') => room.setStage({ kind: 'peer', id: st.id, view });
  return (
    <div className="glass segmented" role="group" aria-label="What to show">
      <button className={st.view === 'cam' ? 'on' : ''} onClick={() => set('cam')} title="Camera full screen">
        <User size={16} /> Camera
      </button>
      <button className={st.view === 'screen' ? 'on' : ''} onClick={() => set('screen')} title="Screen with camera overlay">
        <Screen size={16} /> Screen
      </button>
    </div>
  );
}

function RoomMenu({ room, s, close, onEdit, onDetails, onLeave }: { room: Room; s: Snapshot; close: () => void; onEdit: () => void; onDetails: () => void; onLeave: () => void }) {
  const relayed = [...s.peers.values()].filter((p) => p.route === 'relay').length;
  const status =
    s.meshStatus === 'error' ? "Can't reach VDO.Ninja" : s.meshStatus === 'connecting' ? 'Connecting…' : `${s.peers.size + 1} here · ${relayed ? `${relayed} relayed` : 'all peer-to-peer'}`;
  return (
    <div className="menu-list">
      <div className="menu-head">
        <strong>{room.roomName}</strong>
        <span className={`status ${s.meshStatus === 'error' ? 'bad' : ''}`}>
          {s.meshStatus === 'connected' && <span className="status-dot" />} {status}
        </span>
      </div>
      <CopyItem text={inviteLink(room.roomName)} label="Copy invite link" close={close} />
      <button onClick={onEdit}>
        <Pencil size={16} /> Edit your name
      </button>
      <DeviceMenu room={room} s={s} kind="cam" label="Camera" icon={<Cam size={16} />} close={close} />
      <DeviceMenu room={room} s={s} kind="mic" label="Microphone" icon={<Mic size={16} />} close={close} />
      <DeviceMenu room={room} s={s} kind="speaker" label="Speakers" icon={<Speaker size={16} />} close={close} />
      <button onClick={onDetails}>
        <Info size={16} /> Recording details
      </button>
      <button className="danger" onClick={onLeave}>
        <Leave size={16} /> Leave room
      </button>
    </div>
  );
}

/** A menu row that opens a side submenu listing devices of one kind, with a check on the current one. */
function DeviceMenu({ room, s, kind, label, icon, close }: { room: Room; s: Snapshot; kind: DeviceKind; label: string; icon: React.ReactNode; close: () => void }) {
  const [open, setOpen] = useState(false);
  const list = kind === 'cam' ? s.devices.cams : kind === 'mic' ? s.devices.mics : s.devices.speakers;
  const current = s.current[kind] ?? (kind === 'speaker' ? 'default' : null);
  const name = (d: MediaDeviceInfo, i: number) => d.label || `${label} ${i + 1}`;
  return (
    <div className="has-sub" onMouseEnter={() => (setOpen(true), room.refreshDevices())} onMouseLeave={() => setOpen(false)}>
      <button onClick={() => setOpen(!open)} aria-haspopup="menu" aria-expanded={open}>
        {icon} {label}
        <Chevron size={16} className="chev" />
      </button>
      {open && (
        <div className="submenu" role="menu">
          {list.length === 0 && <div className="empty">{kind === 'speaker' ? 'This browser can’t choose speakers.' : 'No devices found.'}</div>}
          {list.map((d, i) => (
            <button
              key={d.deviceId || i}
              role="menuitemradio"
              aria-checked={d.deviceId === current}
              onClick={() => {
                room.useDevice(kind, d.deviceId);
                close();
              }}
            >
              <span className="tick">{d.deviceId === current && <Check size={16} />}</span>
              <span className="dev">{name(d, i)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function CopyItem({ text, label, close }: { text: string; label: string; close: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(close, 700);
        } catch {
          prompt(label, text);
        }
      }}
    >
      <Copy size={16} /> {copied ? 'Copied' : label}
    </button>
  );
}

function RecIndicator({ s }: { s: Snapshot }) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!s.recording) return;
    const id = setInterval(() => tick((n) => n + 1), 500);
    return () => clearInterval(id);
  }, [s.recording]);
  if (!s.recording || s.takeStartLocal === null) return null;
  const elapsed = performance.timeOrigin + performance.now() - s.takeStartLocal;
  return (
    <span className="glass chip rec-chip">
      <span className="rec-dot" /> {elapsed < 0 ? 'Get ready' : `REC ${fmtClock(elapsed)}`}
    </span>
  );
}

export function nameOf(s: Snapshot, id: PeerId) {
  if (id === s.me) return s.profile.name || 'You';
  return s.peers.get(id)?.presence?.profile.name || 'Someone';
}
