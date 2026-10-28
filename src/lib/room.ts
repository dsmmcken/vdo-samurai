// The room controller: everything that isn't drawing pixels.
//
//  - Shared state (director, tile order, stage, take) is a set of last-writer-wins
//    registers, gossiped to every Link and re-flooded when it changes us.
//  - Each Link runs an NTP-style ping so we know every peer's clock offset. The
//    take's start time is fixed on the director's clock, so every peer starts
//    its recorder at the same instant, and records how late it actually started.
//  - The director logs every stage change during a take; that log drives the edit.
//  - After the take, everyone uploads their files to the director over our own
//    data channels, resumably, and deletes them once the director confirms.
import { Mesh } from './mesh';
import { saveProfile } from './identity';
import type { Link } from './link';
import { camEncoding, devicePref, MIC_ENCODING, openMicTrack, openScreen, openVideoTrack, screenEncoding, setDevicePref, type CamRole, type DeviceKind } from './media';
import { captureStatus, fileExtension, markCaptureBroken, startRecorder, type Recorder } from './recorder';
import * as fs from './opfs';
import type {
  Corner,
  PipStyle,
  DirectorManifest,
  PeerId,
  Presence,
  Profile,
  RaceRow,
  RecFile,
  SenderManifest,
  SharedKey,
  SharedState,
  Stage,
  Stamped,
  Take,
} from './types';
import { now, rid, sleep } from './util';

const CHUNK = 64 * 1024;
const HIGH_WATER = 8 * 1024 * 1024;
export const COUNTDOWN_MS = 3000;
const LEAD_MS = 1500; // time for the start message to reach everyone, and for recorders to spin up
// Recorders start as soon as the take is announced, before the countdown shows:
// spinning up encoders makes the page hitch, and that shouldn't land on "3".
const PREROLL_MS = COUNTDOWN_MS + LEAD_MS;

export interface PeerView {
  id: PeerId;
  presence: Presence | null;
  cam: MediaStream | null;
  screen: MediaStream | null;
  route: 'direct' | 'relay' | null;
}

export interface RenderState {
  state: 'waiting' | 'rendering' | 'done' | 'error';
  progress: number;
  speed: number;
  error?: string;
  url?: string;
  bytes?: number;
}

export interface Snapshot {
  me: PeerId;
  profile: Profile;
  micMuted: boolean;
  camOff: boolean;
  cam: MediaStream | null;
  devices: { cams: MediaDeviceInfo[]; mics: MediaDeviceInfo[]; speakers: MediaDeviceInfo[] };
  current: { cam: string | null; mic: string | null; speaker: string | null };
  screen: MediaStream | null;
  meshStatus: Mesh['status'];
  meshError: string | null;
  peers: Map<PeerId, PeerView>;
  tiles: PeerId[];
  director: PeerId | null;
  stage: Stage | null;
  corner: Corner;
  pip: PipStyle;
  take: Take | null;
  /** Take start/stop on our own clock. */
  takeStartLocal: number | null;
  takeStopLocal: number | null;
  recording: boolean;
  race: RaceRow[] | null;
  myUpload: { sent: number; total: number; done: boolean } | null;
  render: RenderState | null;
  directorTake: DirectorManifest | null;
  /** This person's recording report for the current (or latest) take. */
  myReport: string[] | null;
  notice: string | null;
}

type Listener = () => void;

export class Room {
  readonly me: PeerId;
  profile: Profile;
  private mesh: Mesh;
  private cam: MediaStream | null = null;
  private screen: MediaStream | null = null;
  private micMuted = false;
  private camOff = false;
  private presences = new Map<PeerId, Presence>();
  private clocks = new Map<PeerId, { samples: { rtt: number; offset: number }[] }>();
  private lamport = 0;
  private shared: SharedState = {
    director: { v: null, ts: 0, by: '' },
    order: { v: [], ts: 0, by: '' },
    stage: { v: null, ts: 0, by: '' },
    corner: { v: 'br', ts: 0, by: '' },
    pip: { v: { shape: 'rect', hidden: false }, ts: 0, by: '' },
    take: { v: null, ts: 0, by: '' },
  };

  // Recording (every peer)
  private active: { take: Take; began: boolean; recorders: Recorder[]; stopping: boolean } | null = null;
  private mine = new Map<string, SenderManifest>();
  private purged = new Set<string>();
  private upload = new Map<string, { sent: number; total: number }>();
  private uploading = false;
  private uploadQueue: { takeId: string; name: string; offset: number }[] = [];
  private race: { takeId: string; rows: RaceRow[] } | null = null;

  // Director only
  private dm: DirectorManifest | null = null;
  private receiving = new Set<string>();
  private render: RenderState | null = null;
  private worker: Worker | null = null;

  private listeners = new Set<Listener>();
  private snapshot!: Snapshot;
  private dirty = false;
  private notice: string | null = null;
  private timers: ReturnType<typeof setInterval>[] = [];

  constructor(
    me: PeerId,
    readonly roomName: string,
    readonly password: string,
    profile: Profile,
  ) {
    this.me = me;
    this.profile = profile;
    this.mesh = new Mesh(me, roomName, password, (link) => this.attach(link), () => this.changed());
    this.rebuild();
  }

  // ------------------------------------------------------------------ lifecycle

  /** `cam` may arrive without a video track (camera turned off in the lobby). */
  async start(cam: MediaStream, opts: { micMuted?: boolean; camOff?: boolean } = {}) {
    this.cam = cam;
    this.micMuted = !!opts.micMuted;
    this.camOff = !!opts.camOff || cam.getVideoTracks().length === 0;
    cam.getAudioTracks().forEach((t) => (t.enabled = !this.micMuted));
    this.refreshDevices();
    navigator.mediaDevices.addEventListener?.('devicechange', () => this.refreshDevices());
    await this.restore();
    this.timers.push(setInterval(() => this.pingAll(), 5000));
    this.timers.push(setInterval(() => this.directorTick(), 500));
    window.addEventListener('pagehide', () => this.mesh.broadcast({ t: 'bye' }));
    await this.mesh.start();
  }

  async leave() {
    this.timers.forEach(clearInterval);
    // Camera, mic and screen first: disconnecting from signaling can take a
    // moment, and the camera light shouldn't wait for it.
    this.cam?.getTracks().forEach((t) => t.stop());
    this.screen?.getTracks().forEach((t) => t.stop());
    for (const r of this.active?.recorders ?? []) if (r.recording) r.stop().catch(() => {});
    await this.mesh.stop();
  }

  /** Picks up unfinished business from OPFS after a reload. */
  private async restore() {
    for (const takeId of await fs.listTakes()) {
      const dm = await fs.readJson<DirectorManifest>(takeId, 'director.json');
      if (dm?.downloaded) {
        await fs.removeTake(takeId);
        continue;
      }
      if (dm && dm.take.director === this.me) {
        // A file can finish arriving (and be confirmed to its sender, who then
        // deletes it) just before a reload, before that was saved here. Trust
        // what's on disk: every byte present means it's complete.
        for (const f of Object.values(dm.files)) {
          if (f.done) continue;
          const onDisk = await fs.fileSize(takeId, f.name);
          f.received = Math.min(onDisk, f.size);
          if (f.size > 0 && onDisk >= f.size) f.done = true;
        }
        for (const peer of dm.announced) {
          const files = Object.values(dm.files).filter((f) => f.peer === peer);
          if (files.length && files.every((f) => f.done)) dm.finishedAt[peer] ??= now();
        }
        this.dm = dm;
        this.render = dm.rendered ? await this.finishedRender(takeId) : { state: 'waiting', progress: 0, speed: 0 };
        this.saveDm();
      }
      const mine = await fs.readJson<SenderManifest>(takeId, 'mine.json');
      if (mine && mine.take.director !== this.me) {
        if (mine.files.every((f) => mine.acked.includes(f.name))) await fs.removeTake(takeId);
        else this.mine.set(takeId, mine);
      } else if (mine) {
        this.mine.set(takeId, mine);
      }
    }
    // Files cut short by a reload: whatever reached disk is still a usable recording.
    for (const m of this.mine.values()) {
      for (const f of m.files) if (!f.size) f.size = await fs.fileSize(m.take.id, f.name);
      if (m.take.stopAt) await this.finishMine(m.take);
    }
    this.changed();
  }

  // ------------------------------------------------------------------ React glue

  subscribe = (fn: Listener) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getSnapshot = () => this.snapshot;

  private changed() {
    if (this.dirty) return;
    this.dirty = true;
    queueMicrotask(() => {
      this.dirty = false;
      this.rebuild();
      this.listeners.forEach((fn) => fn());
    });
  }

  private rebuild() {
    const peers = new Map<PeerId, PeerView>();
    for (const link of this.mesh.openLinks()) {
      const p = this.presences.get(link.peer) ?? null;
      peers.set(link.peer, {
        id: link.peer,
        presence: p,
        cam: (p?.camStreamId && link.remoteStreams.get(p.camStreamId)) || null,
        screen: (p?.hasScreen && p.screenStreamId && link.remoteStreams.get(p.screenStreamId)) || null,
        route: link.route,
      });
    }
    const take = this.shared.take.v;
    const dir = take ? this.dirOffset(take) : null;
    let myUpload: Snapshot['myUpload'] = null;
    for (const m of this.mine.values()) {
      if (m.take.director === this.me || !m.complete || m.take.id !== take?.id) continue;
      const total = m.files.reduce((a, f) => a + f.size, 0);
      const done = m.files.every((f) => m.acked.includes(f.name));
      const sent = done ? total : m.files.reduce((a, f) => a + (m.acked.includes(f.name) ? f.size : this.upload.get(`${m.take.id}/${f.name}`)?.sent ?? 0), 0);
      myUpload = { sent, total, done };
    }
    if (this.race && myUpload === null && this.dm === null && this.race.rows.some((r) => r.peer === this.me && r.done))
      myUpload = { sent: 1, total: 1, done: true };
    this.snapshot = {
      me: this.me,
      profile: this.profile,
      micMuted: this.micMuted,
      camOff: this.camOff,
      cam: this.cam,
      devices: {
        cams: this.devices.filter((d) => d.kind === 'videoinput'),
        mics: this.devices.filter((d) => d.kind === 'audioinput'),
        speakers: this.devices.filter((d) => d.kind === 'audiooutput'),
      },
      current: {
        cam: this.cam?.getVideoTracks()[0]?.getSettings().deviceId ?? devicePref('cam'),
        mic: this.cam?.getAudioTracks()[0]?.getSettings().deviceId ?? devicePref('mic'),
        speaker: this.speaker,
      },
      screen: this.screen,
      meshStatus: this.mesh.status,
      meshError: this.mesh.error,
      peers,
      tiles: this.tiles(peers),
      director: this.shared.director.v,
      stage: this.shared.stage.v,
      corner: this.shared.corner.v,
      pip: this.shared.pip.v,
      take,
      takeStartLocal: take && dir !== null ? take.startAt - dir : null,
      takeStopLocal: take?.stopAt && dir !== null ? take.stopAt - dir : null,
      recording: !!take && !take.stopAt,
      race: this.race && take && this.race.takeId === take.id ? this.race.rows : null,
      myUpload,
      render: this.render,
      directorTake: this.dm,
      myReport: (take && this.mine.get(take.id)?.report) || [...this.mine.values()].at(-1)?.report || null,
      notice: this.notice,
    };
  }

  private tiles(peers: Map<PeerId, PeerView>) {
    const present = new Set([this.me, ...peers.keys()]);
    const order = this.shared.order.v.filter((id) => present.has(id));
    const rest = [...present].filter((id) => !order.includes(id)).sort();
    return [...order, ...rest];
  }

  private say(msg: string | null) {
    this.notice = msg;
    this.changed();
    if (msg) setTimeout(() => this.notice === msg && this.say(null), 4000);
  }

  // ------------------------------------------------------------------ shared state

  private newer(a: Stamped<unknown>, b: Stamped<unknown>) {
    return a.ts > b.ts || (a.ts === b.ts && a.by > b.by);
  }

  private set<K extends SharedKey>(key: K, v: SharedState[K]['v']) {
    const st = { v, ts: ++this.lamport, by: this.me } as SharedState[K];
    this.shared[key] = st;
    this.mesh.broadcast({ t: 'set', key, st });
    this.onShared(key);
  }

  private merge(key: SharedKey, st: Stamped<any>, from: PeerId) {
    this.lamport = Math.max(this.lamport, st.ts);
    if (!this.newer(st, this.shared[key])) return;
    const take = this.shared.take.v;
    const locked = take && !take.stopAt;
    // During a take only the director can move the stage, and nobody can take the chair.
    if ((key === 'stage' || key === 'corner' || key === 'pip') && locked && st.by !== take.director) return;
    if (key === 'director' && locked && st.v !== take.director) return;
    if (key === 'order' && locked) return;
    (this.shared as any)[key] = st;
    this.mesh.broadcast({ t: 'set', key, st }, from);
    this.onShared(key);
  }

  private onShared(key: SharedKey) {
    if (key === 'take') this.onTake();
    if (key === 'stage' || key === 'corner' || key === 'pip') this.logStage();
    if (key === 'stage') this.applyEncodings();
    this.changed();
  }

  // ------------------------------------------------------------------ links

  private attach(link: Link) {
    const peer = link.peer;
    let greeted = false;
    link.on('message', (m) => this.onMessage(peer, link, m));
    link.on('stream', () => this.changed());
    link.on('fileChannel', (ch) => this.receiveFile(peer, ch));
    link.on('state', () => {
      if (link.open && !greeted) {
        greeted = true;
        link.send({ t: 'hello', presence: this.presence() });
        link.send({ t: 'state', shared: this.shared });
        this.syncClock(link);
        if (this.race) link.send({ t: 'race', takeId: this.race.takeId, rows: this.race.rows });
        // The director (re)appeared: resume any uploads we owe them.
        for (const m of this.mine.values()) if (m.take.director === peer) this.offerFiles(m.take.id);
      }
      this.changed();
    });
    link.pc.addEventListener('signalingstatechange', () => link.pc.signalingState === 'stable' && this.applyEncodings(link));
    this.pushTracks(link);
  }

  private presence(): Presence {
    return {
      profile: this.profile,
      hasScreen: !!this.screen,
      micMuted: this.micMuted,
      camOff: this.camOff,
      camStreamId: this.cam?.id ?? null,
      screenStreamId: this.screen?.id ?? null,
    };
  }

  private announce() {
    this.mesh.broadcast({ t: 'hello', presence: this.presence() });
    this.changed();
  }

  private onMessage(peer: PeerId, link: Link, m: any) {
    switch (m.t) {
      case 'hello':
        this.presences.set(peer, m.presence);
        if (this.dm && this.active) this.dm.profiles[peer] = m.presence.profile;
        this.changed();
        break;
      case 'state':
        for (const key of Object.keys(m.shared) as SharedKey[]) this.merge(key, m.shared[key], peer);
        break;
      case 'set':
        this.merge(m.key, m.st, peer);
        break;
      case 'ping':
        link.send({ t: 'pong', a: m.a, b: now() });
        break;
      case 'pong':
        this.onPong(peer, m.a, m.b);
        break;
      case 'bye':
        this.mesh.drop(peer);
        break;
      case 'rec':
        this.dmOnRec(peer, m.takeId, m.profile);
        break;
      case 'files':
        this.dmOnFiles(peer, link, m.takeId, m.files, m.report, m.camOff);
        break;
      case 'want':
        this.uploadQueue.push({ takeId: m.takeId, name: m.name, offset: m.offset });
        this.pumpUploads();
        break;
      case 'ack':
        this.onAck(m.takeId, m.name);
        break;
      case 'rename':
        this.setProfile(m.profile);
        saveProfile(m.profile);
        break;
      case 'race':
        this.race = { takeId: m.takeId, rows: m.rows };
        this.changed();
        break;
    }
  }

  // ------------------------------------------------------------------ clocks

  private async syncClock(link: Link) {
    for (let i = 0; i < 6 && link.open; i++) {
      link.send({ t: 'ping', a: now() });
      await sleep(150);
    }
  }

  private pingAll() {
    for (const l of this.mesh.openLinks()) l.send({ t: 'ping', a: now() });
  }

  private onPong(peer: PeerId, a: number, b: number) {
    const c = now();
    const entry = this.clocks.get(peer) ?? { samples: [] };
    entry.samples.push({ rtt: c - a, offset: b - (a + c) / 2 });
    if (entry.samples.length > 12) entry.samples.shift();
    this.clocks.set(peer, entry);
    if (entry.samples.length === 3) this.changed(); // first usable estimate
  }

  /** Remote clock minus our clock, from the lowest-RTT recent sample. */
  offsetTo(peer: PeerId): number | null {
    if (peer === this.me) return 0;
    const s = this.clocks.get(peer)?.samples;
    if (!s || s.length < 3) return null;
    return s.reduce((best, x) => (x.rtt < best.rtt ? x : best)).offset;
  }

  private dirOffset(take: Take) {
    return this.offsetTo(take.director);
  }

  // ------------------------------------------------------------------ live media

  private pushTracks(link: Link) {
    const tracks: Parameters<Link['setTracks']>[0] = [];
    if (this.cam) {
      const mic = this.cam.getAudioTracks()[0] ?? null;
      const cam = this.cam.getVideoTracks()[0] ?? null;
      tracks.push({ role: 'mic', track: mic, stream: this.cam, enc: MIC_ENCODING });
      // While the camera is off its sender stays, sending nothing; turning it
      // back on just swaps a track in.
      tracks.push({ role: 'cam', track: cam, stream: this.cam, enc: cam ? camEncoding(cam, this.camRole()) : {} });
    }
    const screen = this.screen?.getVideoTracks()[0];
    if (screen && this.screen) tracks.push({ role: 'screen', track: screen, stream: this.screen, enc: screenEncoding(screen, this.screenOnStage()) });
    link.setTracks(tracks);
  }

  private pushAll() {
    for (const l of this.mesh.links.values()) this.pushTracks(l);
    this.applyEncodings();
  }

  private camRole(): CamRole {
    const s = this.shared.stage.v;
    if (!s) return 'tile';
    if (s.kind === 'end') return 'grid';
    if (s.id !== this.me) return 'tile';
    return s.view === 'cam' || !this.screen ? 'stage' : 'tile';
  }

  private screenOnStage() {
    const s = this.shared.stage.v;
    return !!this.screen && s?.kind === 'peer' && s.id === this.me && s.view === 'screen';
  }

  private applyEncodings(only?: Link) {
    const role = this.camRole();
    const onStage = this.screenOnStage();
    for (const link of only ? [only] : this.mesh.links.values()) {
      for (const t of this.cam?.getVideoTracks() ?? []) link.setEncoding('cam', camEncoding(t, role));
      for (const t of this.screen?.getVideoTracks() ?? []) link.setEncoding('screen', screenEncoding(t, onStage));
    }
  }

  async toggleScreen() {
    if (this.screen) {
      this.stopScreen();
      return;
    }
    try {
      const s = await openScreen();
      this.screen = s;
      s.getVideoTracks()[0]?.addEventListener('ended', () => this.screen === s && this.stopScreen());
      for (const l of this.mesh.links.values()) this.pushTracks(l);
      this.announce();
      if (this.active?.began) this.startRecorder('screen');
      // Sharing while you're on stage puts the screen up.
      const st = this.shared.stage.v;
      if (st?.kind === 'peer' && st.id === this.me && this.canSetStage()) this.set('stage', { ...st, view: 'screen' });
    } catch {
      /* user cancelled the picker */
    }
  }

  private stopScreen() {
    const s = this.screen;
    if (!s) return;
    this.screen = null;
    s.getTracks().forEach((t) => t.stop());
    for (const r of this.active?.recorders ?? []) if (r.kind === 'screen' && r.recording) this.finishRecorder(r);
    for (const l of this.mesh.links.values()) this.pushTracks(l);
    this.applyEncodings();
    this.announce();
  }

  /** The running recorder for one kind, if any. */
  private recorderFor(kind: 'cam' | 'screen') {
    return this.active?.recorders.find((r) => r.kind === kind && r.recording) ?? null;
  }

  /**
   * Camera off releases the camera (so its light goes off) and the outgoing
   * sender sends nothing; on reopens it and swaps the new track in, without
   * renegotiating. Tiles and stage show initials meanwhile, and the stretch is
   * logged so the final cut shows initials too.
   */
  async toggleCam() {
    const rec = this.recorderFor('cam');
    if (!this.camOff) {
      this.camOff = true;
      if (rec && !rec.setVideo) {
        // Backup recorder (MediaRecorder) can't swap tracks: just blank the video.
        this.cam?.getVideoTracks().forEach((t) => (t.enabled = false));
      } else {
        for (const t of this.cam?.getVideoTracks() ?? []) {
          this.cam!.removeTrack(t);
          t.stop();
        }
        rec?.setVideo?.(null);
      }
    } else {
      const disabled = this.cam?.getVideoTracks()[0];
      if (disabled) disabled.enabled = true;
      else {
        try {
          const t = await openVideoTrack();
          this.cam?.addTrack(t);
          rec?.setVideo?.(t);
        } catch (e) {
          return this.say(`Couldn't turn the camera back on: ${(e as Error).message}`);
        }
      }
      this.camOff = false;
    }
    this.logCamOff();
    this.pushAll();
    this.announce();
  }

  private logCamOff() {
    const a = this.active;
    const m = a && this.mine.get(a.take.id);
    if (!a || !m) return;
    const at = this.toTake(a.take, now());
    m.camOff ??= [];
    if (this.camOff) m.camOff.push([at, null]);
    else if (m.camOff.length && m.camOff[m.camOff.length - 1][1] === null) m.camOff[m.camOff.length - 1][1] = at;
    fs.writeJson(a.take.id, 'mine.json', m).catch(() => {});
  }

  // ------------------------------------------------------------------ devices

  private devices: MediaDeviceInfo[] = [];
  private speaker: string | null = devicePref('speaker');

  async refreshDevices() {
    try {
      this.devices = await navigator.mediaDevices.enumerateDevices();
    } catch {
      this.devices = [];
    }
    this.changed();
  }

  /** Switch camera, microphone or speakers; applies live, even mid-take, and is remembered. */
  async useDevice(kind: DeviceKind, id: string) {
    setDevicePref(kind, id);
    if (kind === 'speaker') {
      this.speaker = id;
      return this.changed();
    }
    const rec = this.recorderFor('cam');
    if (rec && !rec.setVideo) return this.say('Switching devices mid-take needs the main recorder; it will apply after this take.');
    if (kind === 'cam' && this.camOff) return this.changed(); // used when the camera comes back on
    try {
      const t = kind === 'cam' ? await openVideoTrack(id) : await openMicTrack(id);
      if (kind === 'mic') t.enabled = !this.micMuted;
      const old = kind === 'cam' ? this.cam?.getVideoTracks()[0] : this.cam?.getAudioTracks()[0];
      if (old) {
        this.cam!.removeTrack(old);
        old.stop();
      }
      this.cam?.addTrack(t);
      if (kind === 'cam') rec?.setVideo?.(t);
      else rec?.setAudio?.(t);
      this.note(this.active?.take.id ?? '', `${kind === 'cam' ? 'camera' : 'microphone'} switched to ${t.label || 'another device'}`);
      this.pushAll();
      this.announce();
    } catch (e) {
      this.say(`Couldn't switch ${kind === 'cam' ? 'camera' : 'microphone'}: ${(e as Error).message}`);
    }
  }

  /** Change the overlay's shape or hide / show it; same rule as moving it. */
  setPip(pip: Partial<PipStyle>) {
    if (!this.canSetStage()) return this.say('Only the Shōgun (director) can change the overlay while recording.');
    const next = { ...this.shared.pip.v, ...pip };
    if (next.shape !== this.shared.pip.v.shape || next.hidden !== this.shared.pip.v.hidden) this.set('pip', next);
  }

  /** Move the presenter's camera overlay; anyone before a take, only the director during one. */
  setCorner(c: Corner) {
    if (!this.canSetStage()) return this.say('Only the Shōgun (director) can move the overlay while recording.');
    if (this.shared.corner.v !== c) this.set('corner', c);
  }

  toggleMic() {
    this.micMuted = !this.micMuted;
    this.cam?.getAudioTracks().forEach((t) => (t.enabled = !this.micMuted));
    this.announce();
  }

  setProfile(p: Profile) {
    this.profile = p;
    if (this.dm) this.dm.profiles[this.me] = p;
    this.announce();
  }

  // ------------------------------------------------------------------ room actions

  private takeLocked() {
    const t = this.shared.take.v;
    return !!t && !t.stopAt;
  }

  canSetStage() {
    return !this.takeLocked() || this.shared.director.v === this.me;
  }

  /** Clicking a tile: put it on stage, or flip camera/screen if it's already there. */
  clickTile(id: PeerId | 'end') {
    if (!this.canSetStage()) return this.say('Only the Shōgun (director) can switch the stage while recording.');
    if (id === 'end') return this.set('stage', { kind: 'end' });
    const hasScreen = id === this.me ? !!this.screen : !!this.presences.get(id)?.hasScreen;
    const cur = this.shared.stage.v;
    if (cur?.kind === 'peer' && cur.id === id) {
      if (hasScreen) this.set('stage', { kind: 'peer', id, view: cur.view === 'screen' ? 'cam' : 'screen' });
      return;
    }
    this.set('stage', { kind: 'peer', id, view: hasScreen ? 'screen' : 'cam' });
  }

  /** Put a specific view on stage (the Camera / Screen toggle). */
  setStage(stage: Stage) {
    if (!this.canSetStage()) return this.say('Only the Shōgun (director) can switch the stage while recording.');
    this.set('stage', stage);
  }

  reorder(order: PeerId[]) {
    if (this.takeLocked()) return this.say('Tiles are locked while recording.');
    this.set('order', order);
  }

  /** Anyone can make anyone (or nobody) the director, except while recording. */
  setDirector(id: PeerId | null) {
    if (this.takeLocked()) return this.say("The Shōgun (director) can't change while recording.");
    this.set('director', id);
    // The director's tile always leads the strip.
    if (id) this.set('order', [id, ...this.tiles(this.snapshot.peers).filter((x) => x !== id)]);
  }

  /** Anyone can fix anyone's name; the owner applies it and tells everyone. */
  setProfileOf(id: PeerId, p: Profile) {
    if (id === this.me) return this.setProfile(p);
    this.mesh.links.get(id)?.send({ t: 'rename', profile: p });
  }

  startRecording() {
    if (this.shared.director.v !== this.me || this.takeLocked()) return;
    if (this.dm && !this.dm.downloaded) return this.say('Download or discard the last take first.'); // the UI asks before calling us
    if (this.dm) void this.discardTake(); // downloaded already: just clear it
    const missing = this.mesh.openLinks().filter((l) => this.offsetTo(l.peer) === null);
    if (missing.length) return this.say('Still syncing clocks, try again in a second.');
    this.set('take', { id: `${new Date().toISOString().slice(0, 10)}-${rid(6)}`, director: this.me, startAt: now() + COUNTDOWN_MS + LEAD_MS });
  }

  stopRecording() {
    const t = this.shared.take.v;
    if (!t || t.stopAt || t.director !== this.me) return;
    this.set('take', { ...t, stopAt: Math.max(now(), t.startAt) });
  }

  // ------------------------------------------------------------------ recording (every peer)

  private onTake() {
    const take = this.shared.take.v;
    if (!take) return;
    if (!take.stopAt && this.active?.take.id !== take.id) this.beginTake(take);
    if (take.stopAt) {
      if (this.active?.take.id === take.id) this.endTake(take);
      else if (this.mine.has(take.id)) this.finishMine(take);
    }
  }

  private async beginTake(take: Take) {
    if (this.active) await this.endTake(this.active.take);
    const a: NonNullable<Room['active']> = (this.active = { take, began: false, recorders: [], stopping: false });
    if (take.director === this.me) {
      this.dm = {
        take,
        stageLog: [],
        order: this.tiles(this.snapshot.peers),
        profiles: { [this.me]: this.profile },
        expected: [this.me],
        files: {},
        announced: [],
        finishedAt: {},
      };
      for (const [id, p] of this.presences) this.dm.profiles[id] = p.profile;
      this.render = null;
      this.race = null;
      this.saveDm();
    }
    // Wait for a clock estimate (late joiners), then start recording as the
    // countdown begins. Starting a 1080p recorder stalls Chrome's capture for a
    // moment; this way the stall lands in the pre-roll, not at "go". Each file
    // records exactly when it started, so the edit still begins at zero.
    while (this.dirOffset(take) === null && this.active === a) await sleep(100);
    if (this.active !== a || a.stopping) return;
    const wait = take.startAt - PREROLL_MS - this.dirOffset(take)! - now();
    if (wait > 0) await sleep(wait);
    if (this.active !== a || a.stopping) return;
    a.began = true;
    if (!this.mine.has(take.id)) this.mine.set(take.id, { take, files: [], acked: [], complete: false, camOff: this.camOff ? [[-PREROLL_MS, null]] : [] });
    const v = this.cam?.getVideoTracks()[0]?.getSettings();
    const au = this.cam?.getAudioTracks()[0]?.getSettings();
    this.note(take.id, `browser: ${navigator.userAgent.match(/(Chrome|Firefox|Safari|Edg)\/[\d.]+/g)?.join(' ') ?? navigator.userAgent}; ${navigator.platform}`);
    this.note(take.id, `camera: ${v?.width}x${v?.height} @ ${v?.frameRate?.toFixed?.(0)} fps; mic: ${au?.sampleRate ?? '?'} Hz, ${au?.channelCount ?? '?'} ch, echo cancellation ${au?.echoCancellation}`);
    this.startRecorder('cam');
    if (this.screen) this.startRecorder('screen');
    if (take.director === this.me) {
      if (!this.shared.stage.v) this.set('stage', { kind: 'peer', id: this.me, view: 'cam' });
      else this.logStage();
    } else {
      this.mesh.links.get(take.director)?.send({ t: 'rec', takeId: take.id, profile: this.profile });
    }
    this.changed();
  }

  private startRecorder(kind: 'cam' | 'screen') {
    const a = this.active;
    const stream = kind === 'cam' ? this.cam : this.screen;
    if (!a || !stream) return;
    const name = `${this.me}-${kind}-${rid(4)}.${fileExtension(kind)}`;
    const rec = startRecorder(a.take.id, name, stream, kind, {
      info: (msg) => this.note(a.take.id, `${kind}: ${msg}`),
      warn: (msg) => {
        this.note(a.take.id, `${kind} WARNING: ${msg}`);
        this.say(`Recording problem (${kind}): ${msg}`);
      },
      // The capture recorder died mid-take: note why, switch this session to
      // MediaRecorder and keep recording into a new file.
      fail: (msg) => {
        this.note(a.take.id, `${kind} ERROR: ${msg} (switching to backup recorder)`);
        markCaptureBroken();
        this.say(`Recorder error (${kind}): ${msg}. Switched to the backup recorder.`);
        const live = (kind === 'cam' ? this.cam : this.screen)?.getVideoTracks().some((t) => t.readyState === 'live');
        if (this.active === a && !a.stopping && live) this.startRecorder(kind);
      },
    });
    this.note(a.take.id, `${kind}: recording ${name} with ${rec.mime === 'video/mp4' && captureStatus() !== false ? 'WebCodecs capture' : `MediaRecorder (${rec.mime})`}`);
    a.recorders.push(rec);
    const m = this.mine.get(a.take.id)!;
    // A first estimate goes on disk right away (so a crash still leaves a usable
    // entry); the exact start replaces it when the recorder finishes.
    rec.started.then((t) => {
      const at = this.toTake(a.take, t);
      m.files.push({ name: rec.name, peer: this.me, kind, offset: at, audioOffset: at, size: 0, mime: rec.mime });
      fs.writeJson(a.take.id, 'mine.json', m);
    });
  }

  /** Adds a line to this person's recording report for a take (sent to the director with the files). */
  private note(takeId: string, line: string) {
    const m = this.mine.get(takeId);
    if (!m) return;
    (m.report ??= []).push(`${new Date().toISOString().slice(11, 23)} ${line}`);
    fs.writeJson(takeId, 'mine.json', m).catch(() => {});
  }

  /** Local wall-clock ms -> ms since the take's start (on the director's clock). */
  private toTake(take: Take, local: number) {
    return local + (this.dirOffset(take) ?? 0) - take.startAt;
  }

  private async finishRecorder(rec: Recorder) {
    const m = this.mine.get(rec.takeId);
    try {
      const r = await rec.stop();
      const f = m?.files.find((x) => x.name === rec.name);
      if (m && f && r.size === 0) {
        // Nothing was captured (e.g. a screen that never sent a frame): drop it.
        m.files = m.files.filter((x) => x !== f);
        this.note(rec.takeId, `${rec.kind}: no frames captured, file dropped`);
        await fs.writeJson(rec.takeId, 'mine.json', m);
      } else if (f && m) {
        const take = this.active?.take ?? m.take;
        f.size = r.size;
        f.offset = this.toTake(take, r.videoZero);
        f.audioOffset = this.toTake(take, r.audioZero);
        f.timing = r.timing;
        await fs.writeJson(rec.takeId, 'mine.json', m);
      }
    } catch (e) {
      // Keep whatever reached disk; the file is fragmented MP4, so it's still readable.
      const msg = String((e as Error)?.message ?? e);
      console.warn('[recorder] failed', e);
      this.note(rec.takeId, `${rec.kind} ERROR at stop: ${msg}`);
      const f = m?.files.find((x) => x.name === rec.name);
      if (f && m) {
        f.size = await fs.fileSize(rec.takeId, rec.name);
        await fs.writeJson(rec.takeId, 'mine.json', m);
      }
    }
  }

  private async endTake(take: Take) {
    const a = this.active;
    if (!a || a.take.id !== take.id || a.stopping) return;
    a.stopping = true;
    await Promise.all(a.recorders.map((r) => this.finishRecorder(r)));
    this.active = null;
    if (this.dm?.take.id === take.id) {
      this.dm.take = take;
      this.saveDm();
    }
    await this.finishMine(take);
  }

  /** Our files for a finished take: register them (director) or start uploading. */
  private async finishMine(take: Take) {
    const m = this.mine.get(take.id);
    if (!m) return;
    m.take = take;
    m.complete = true;
    await fs.writeJson(take.id, 'mine.json', m);
    if (take.director === this.me) {
      if (this.dm?.take.id === take.id) {
        this.dm.take = take; // may have been saved before the stop (reload mid-take)
        for (const f of m.files) this.dm.files[f.name] = { ...f, received: f.size, done: true };
        if (!this.dm.announced.includes(this.me)) this.dm.announced.push(this.me);
        (this.dm.reports ??= {})[this.me] = m.report ?? [];
        (this.dm.camOff ??= {})[this.me] = m.camOff ?? [];
        this.dm.finishedAt[this.me] = now();
        this.saveDm();
      }
    } else {
      this.offerFiles(take.id);
    }
    this.changed();
  }

  // ------------------------------------------------------------------ uploads (non-director)

  private offerFiles(takeId: string) {
    const m = this.mine.get(takeId);
    if (!m || !m.complete) return;
    const link = this.mesh.links.get(m.take.director);
    if (!link?.open) return; // retried when the director (re)connects
    link.send({ t: 'files', takeId, files: m.files.filter((f) => f.size > 0), report: m.report ?? [], camOff: m.camOff ?? [] });
  }

  private async pumpUploads() {
    if (this.uploading) return;
    this.uploading = true;
    try {
      while (this.uploadQueue.length) {
        const job = this.uploadQueue.shift()!;
        await this.sendFile(job.takeId, job.name, job.offset).catch((e) => console.warn('[upload] interrupted', e));
      }
    } finally {
      this.uploading = false;
    }
  }

  private async sendFile(takeId: string, name: string, offset: number) {
    const m = this.mine.get(takeId);
    const link = m && this.mesh.links.get(m.take.director);
    if (!m || !link?.open || m.acked.includes(name)) return;
    const file = await (await (await fs.takeDir(takeId)).getFileHandle(name)).getFile();
    const key = `${takeId}/${name}`;
    const ch = link.pc.createDataChannel(`f:${takeId}:${name}`, { ordered: true });
    ch.binaryType = 'arraybuffer';
    ch.bufferedAmountLowThreshold = HIGH_WATER / 2;
    // Closing a peer connection doesn't fire 'close' on its data channels, so
    // every wait here also checks the connection and gives up on a timeout;
    // otherwise one dead upload would block the queue (and the resume) forever.
    const dead = () => ch.readyState === 'closing' || ch.readyState === 'closed' || ['closed', 'failed'].includes(link.pc.connectionState);
    const until = (ready: () => boolean, ms: number, what: string) =>
      new Promise<void>((res, rej) => {
        const t0 = Date.now();
        const tick = () => {
          if (ready()) return res();
          if (dead()) return rej(new Error(`upload channel closed (${what})`));
          if (Date.now() - t0 > ms) return rej(new Error(`upload timed out (${what})`));
          setTimeout(tick, 100);
        };
        tick();
      });
    try {
      await until(() => ch.readyState === 'open', 20_000, 'opening');
      let pos = offset;
      this.upload.set(key, { sent: pos, total: file.size });
      while (pos < file.size) {
        const block = await file.slice(pos, pos + 16 * CHUNK).arrayBuffer();
        for (let i = 0; i < block.byteLength; i += CHUNK) {
          if (ch.bufferedAmount > HIGH_WATER) await until(() => ch.bufferedAmount <= HIGH_WATER / 2, 60_000, 'sending');
          if (ch.readyState !== 'open') throw new Error('upload channel closed (sending)');
          ch.send(block.slice(i, i + CHUNK));
        }
        pos += block.byteLength;
        this.upload.set(key, { sent: pos - ch.bufferedAmount, total: file.size });
        this.changed();
      }
      ch.send('eof');
      // The director closes the channel after it has flushed the file to disk.
      await until(() => ch.readyState === 'closed', 120_000, 'finishing').catch(() => {});
    } finally {
      if (ch.readyState !== 'closed') ch.close();
    }
  }

  private async onAck(takeId: string, name: string) {
    const m = this.mine.get(takeId);
    // A returning director re-confirms files we've already cleaned up.
    if (!m || this.purged.has(takeId)) return;
    if (!m.acked.includes(name)) m.acked.push(name);
    if (m.complete && m.files.every((f) => f.size === 0 || m.acked.includes(f.name))) {
      // Director has everything: free the disk space.
      this.purged.add(takeId);
      await fs.removeTake(takeId);
    } else {
      await fs.writeJson(takeId, 'mine.json', m).catch(() => {});
    }
    this.changed();
  }

  // ------------------------------------------------------------------ director: receiving

  private saveDm() {
    if (this.dm) fs.writeJson(this.dm.take.id, 'director.json', this.dm);
  }

  private dmOnRec(peer: PeerId, takeId: string, profile: Profile) {
    if (this.dm?.take.id !== takeId) return;
    if (!this.dm.expected.includes(peer)) this.dm.expected.push(peer);
    this.dm.profiles[peer] = profile;
    this.saveDm();
  }

  private async dmOnFiles(peer: PeerId, link: Link, takeId: string, files: RecFile[], report?: string[], camOff?: [number, number | null][]) {
    const dm = this.dm;
    if (dm?.take.id !== takeId) {
      // Not our take (or already discarded): tell them to let it go.
      for (const f of files) link.send({ t: 'ack', takeId, name: f.name });
      return;
    }
    if (!dm.expected.includes(peer)) dm.expected.push(peer);
    if (!dm.announced.includes(peer)) dm.announced.push(peer);
    if (report) (dm.reports ??= {})[peer] = report;
    if (camOff) (dm.camOff ??= {})[peer] = camOff;
    for (const f of files) {
      const have = dm.files[f.name];
      if (have?.done) {
        link.send({ t: 'ack', takeId, name: f.name });
        continue;
      }
      if (this.receiving.has(f.name)) continue;
      const onDisk = await fs.fileSize(takeId, f.name);
      dm.files[f.name] = { ...f, peer, received: Math.min(onDisk, f.size), done: false };
      link.send({ t: 'want', takeId, name: f.name, offset: dm.files[f.name].received });
    }
    this.saveDm();
    this.directorTick();
  }

  private receiveFile(peer: PeerId, ch: RTCDataChannel) {
    const [, takeId, name] = ch.label.split(':');
    const dm = this.dm;
    const f = dm?.files[name];
    if (!dm || dm.take.id !== takeId || !f || f.peer !== peer || f.done) return ch.close();
    ch.binaryType = 'arraybuffer';
    this.receiving.add(name);
    const writer = new fs.SequentialWriter(takeId, name, f.received);
    let base = f.received;
    let finished = false;
    ch.onmessage = async (e) => {
      if (typeof e.data === 'string') {
        if (e.data !== 'eof') return;
        finished = true;
        await writer.close().catch(() => {});
        f.received = writer.written;
        f.done = f.received === f.size;
        this.receiving.delete(name);
        if (f.done) this.mesh.links.get(peer)?.send({ t: 'ack', takeId, name });
        this.checkPeerDone(peer);
        this.saveDm();
        ch.close();
        return;
      }
      base += e.data.byteLength;
      f.received = base;
      writer.write(e.data);
    };
    ch.onclose = async () => {
      if (finished) return;
      await writer.close().catch(() => {});
      f.received = writer.written;
      this.receiving.delete(name);
      this.saveDm();
    };
  }

  private checkPeerDone(peer: PeerId) {
    const dm = this.dm!;
    const files = Object.values(dm.files).filter((f) => f.peer === peer);
    if (dm.announced.includes(peer) && files.every((f) => f.done) && !dm.finishedAt[peer]) dm.finishedAt[peer] = now();
  }

  /** Twice a second: broadcast the upload race and start rendering when everything's in. */
  private directorTick() {
    const dm = this.dm;
    if (!dm || !dm.take.stopAt || dm.rendered) return;
    const rows: RaceRow[] = dm.expected
      .filter((p) => p !== this.me)
      .map((peer) => {
        const files = Object.values(dm.files).filter((f) => f.peer === peer);
        const announced = dm.announced.includes(peer);
        return {
          peer,
          name: dm.profiles[peer]?.name || 'Guest',
          received: files.reduce((a, f) => a + f.received, 0),
          total: files.reduce((a, f) => a + f.size, 0),
          announced,
          done: announced && files.every((f) => f.done),
          finishedAt: dm.finishedAt[peer],
        };
      });
    this.race = { takeId: dm.take.id, rows };
    this.mesh.broadcast({ t: 'race', takeId: dm.take.id, rows });
    // Senders that reconnected after a drop re-offer their files themselves (see attach).
    if (rows.every((r) => r.done) && dm.announced.includes(this.me) && this.render?.state !== 'rendering') this.startRender();
    this.changed();
  }

  // ------------------------------------------------------------------ director: render

  startRender() {
    const dm = this.dm;
    if (!dm || !dm.take.stopAt || this.render?.state === 'rendering') return;
    this.render = { state: 'rendering', progress: 0, speed: 0 };
    this.saveDm();
    this.worker?.terminate();
    const w = (this.worker = new Worker(new URL('../compositor/worker.ts', import.meta.url), { type: 'module' }));
    w.onmessage = async (e) => {
      const m = e.data;
      if (m.t === 'progress') this.render = { state: 'rendering', progress: m.progress, speed: m.speed };
      if (m.t === 'warn') {
        console.warn('[compositor]', m.message);
        ((dm.reports ??= {}).render ??= []).push(`WARNING: ${m.message}`);
        this.say(`Heads up: ${m.message}`);
      }
      if (m.t === 'error') ((dm.reports ??= {}).render ??= []).push(`ERROR: ${m.error}`);
      if (m.t === 'info') ((dm.reports ??= {}).render ??= []).push(m.message);
      if (m.t === 'error') this.render = { state: 'error', progress: 0, speed: 0, error: m.error };
      if (m.t === 'done') {
        dm.rendered = true;
        this.saveDm();
        // Sources aren't needed any more; only the final cut stays until it's downloaded.
        for (const f of Object.keys(dm.files)) await fs.removeFile(dm.take.id, f);
        this.render = await this.finishedRender(dm.take.id);
        w.terminate();
      }
      this.changed();
    };
    w.postMessage({ manifest: dm });
    this.changed();
  }

  private async finishedRender(takeId: string): Promise<RenderState> {
    try {
      const file = await (await (await fs.takeDir(takeId)).getFileHandle('final.mp4')).getFile();
      return { state: 'done', progress: 1, speed: 0, url: URL.createObjectURL(file), bytes: file.size };
    } catch {
      return { state: 'error', progress: 0, speed: 0, error: 'The rendered file is missing.' };
    }
  }

  markDownloaded() {
    if (!this.dm) return;
    this.dm.downloaded = true;
    this.saveDm();
    this.changed();
  }

  /** Throws away the director's take (after download, or to abandon it). */
  async discardTake() {
    const dm = this.dm;
    if (!dm) return;
    this.worker?.terminate();
    if (this.render?.url) URL.revokeObjectURL(this.render.url);
    this.dm = null;
    this.render = null;
    this.race = null;
    this.mine.delete(dm.take.id);
    await fs.removeTake(dm.take.id);
    this.changed();
  }

  // ------------------------------------------------------------------ director: stage log

  private logStage() {
    const dm = this.dm;
    const st = this.shared.stage.v;
    if (!dm || !st || !this.active?.began || this.active.take.id !== dm.take.id) return;
    if (this.shared.take.v?.stopAt) return;
    dm.stageLog.push({ t: Math.max(0, now() - dm.take.startAt), stage: st, corner: this.shared.corner.v, pip: this.shared.pip.v });
    for (const [id, p] of this.presences) dm.profiles[id] = p.profile;
    dm.profiles[this.me] = this.profile;
    this.saveDm();
  }
}
