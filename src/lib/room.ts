// The room controller: everything that isn't drawing pixels.
//
//  - Shared state (director, tile order, stage, take) is a set of last-writer-wins
//    registers, gossiped to every Link and re-flooded when it changes us.
//  - Each Link runs an NTP-style ping so we know every peer's clock offset. The
//    take's start time is fixed on the director's clock, so every peer starts
//    its recorder at the same instant, and records how late it actually started.
//  - The director logs every stage change during a take; that log drives the edit.
//  - Anyone can draw on a screen on stage; points go to everyone over our own
//    channels and the director logs them for the final cut (ink.ts).
//  - Emoji reactions work the same way, over the whole stage (reactions.ts);
//    the director also keeps each emoji's animation, so the render is offline.
//  - After the take, everyone uploads their files to the director over our own
//    data channels, resumably, and deletes them once the director confirms.
import { Mesh } from './mesh';
import { saveProfile } from './identity';
import type { Link } from './link';
import { camEncoding, devicePref, MIC_ENCODING, openMicTrack, openScreen, openVideoTrack, screenEncoding, setDevicePref, type CamRole, type DeviceKind } from './media';
import { FaceWatch } from './face/watch';
import { castSupport, ScreenCaster, ScreenView } from './screencast';
import type { Head } from './framing';
import { INK_COLORS, inkAlpha, PLAYBACK_MS, type InkPoint, type InkStroke } from './ink';
import { fetchLottie, FLIGHT_MS, NAME_COOLDOWN_MS, type Reaction } from './reactions';
import { captureStatus, fileExtension, markCaptureBroken, startRecorder, testHook, type Recorder } from './recorder';
import * as fs from './opfs';
import { InPlaceWriter } from './inplace';
import { cutRecording, cuttable, mergeSpans, verifyAgainstSource, verifyCut, type Span } from './cut';
import { shownSpans } from '../compositor/plan';
import { fmtRate, linkStats, mb, StallProbe, tabState, TransferLog } from './xferlog';
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

/**
 * Upload message size: Chrome negotiates 256 KB, which means a quarter of the
 * messages (and events at both ends) of the 64 KB that's safe everywhere.
 * Capped at what the connection says it takes.
 */
const MAX_CHUNK = 256 * 1024;
const SAFE_CHUNK = 64 * 1024;
/** Read from disk this much at a time, the next block while the last one sends. */
const BLOCK = 4 * 1024 * 1024;
/**
 * Queue at most this much in the channel, refilling below a quarter. Chrome's
 * SCTP takes about 2 MB into its own send buffer; anything queued beyond that
 * waits in the data channel's queue, which is where a real upload sat stuck
 * (3.9 MB queued, nothing moving until a retry). Staying under it costs no
 * speed: SCTP's own buffer and window keep the link full.
 */
const HIGH_WATER = 1024 * 1024;
const LOW_WATER = HIGH_WATER / 4;
/** How often a running transfer logs its speed and connection stats. */
const SAMPLE_MS = 5000;
/**
 * A transfer that moves no bytes for this long is dropped and asked for again,
 * from what's on disk, so a retry is cheap. Even a slow link delivers a 256 KB
 * message well within this.
 */
const STALL_MS = 8000;
/**
 * Once bytes are flowing, a transfer counts as stuck sooner: after three
 * messages' worth of silence at its own speed, at least 3 s, at most 15 s. A
 * stuck channel (Chrome holding data in it while the connection is fine) has
 * always moved at full speed again on a fresh one.
 */
const stallAfter = (bytesPerSec: number) => Math.min(15_000, Math.max(3000, (3 * MAX_CHUNK * 1000) / Math.max(1, bytesPerSec)));
/** Senders re-offer unconfirmed files this often, in case a request or confirmation went missing. */
const REOFFER_MS = 10_000;
export const COUNTDOWN_MS = 3000;
/**
 * A shared window that's closed doesn't always end its track: Chrome may just
 * mute it, for good, and everyone keeps seeing its last frame. Muted this
 * long counts as gone.
 */
const SCREEN_GONE_MS = 2000;
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
  /** Our own auto-framing anchor (everyone else's is in their presence). */
  head: Head | null;
  cam: MediaStream | null;
  devices: { cams: MediaDeviceInfo[]; mics: MediaDeviceInfo[]; speakers: MediaDeviceInfo[] };
  current: { cam: string | null; mic: string | null; speaker: string | null };
  screen: MediaStream | null;
  meshStatus: Mesh['status'];
  meshError: string | null;
  peers: Map<PeerId, PeerView>;
  tiles: PeerId[];
  /** The bottom strip: the tiles, with the Multicam tile ('end') wherever it was dragged. */
  strip: (PeerId | 'end')[];
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
  /** File-transfer logs: ours, and (director) each guest's, forwarded as they go. */
  transferLogs: { who: string; lines: string[] }[];
  notice: string | null;
}

type Listener = () => void;

/** A file the director asked for, or is receiving. */
interface Receiving {
  ch: RTCDataChannel | null;
  /** When a byte (or the request) last moved. */
  at: number;
  stop?: () => Promise<void>;
  writer?: InPlaceWriter;
  /** Second-by-second channel and connection stats, logged only if it stalls. */
  probe?: StallProbe;
  /** For the log: when the channel opened, at what offset, and the last speed sample. */
  began?: number;
  from?: number;
  sample?: { bytes: number; at: number };
}

export class Room {
  readonly me: PeerId;
  profile: Profile;
  private mesh: Mesh;
  private cam: MediaStream | null = null;
  private screen: MediaStream | null = null;
  /** Our screen, encoded once for every viewer that can take it (screencast.ts). */
  private caster: ScreenCaster | null = null;
  /** Other people's screens arriving that way. */
  private views = new Map<PeerId, ScreenView>();
  private cast = { send: false, receive: false };
  private micMuted = false;
  private camOff = false;
  private head: Head | null = null;
  private faceWatch = new FaceWatch((h) => this.onHead(h));
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
  /** What our uploads (or, as director, downloads) did; see xferlog.ts. */
  private xlog = new TransferLog();
  /** Director: each guest's transfer log, as forwarded. */
  private peerXlogs = new Map<PeerId, string[]>();
  /** Guest: trims in progress, by take (cut.ts). */
  private cutting = new Map<string, Promise<void>>();
  /** Director: guests already asked to trim this take (for the log). */
  private cutAsked = new Set<PeerId>();
  /** Director: recent received totals per guest, for the race's speed. */
  private raceRates = new Map<PeerId, { bytes: number; at: number; rate: number }>();
  private race: { takeId: string; rows: RaceRow[] } | null = null;

  // Director only
  private dm: DirectorManifest | null = null;
  /**
   * Files asked for or arriving, by name: the channel once it's open, and when
   * a byte (or the request) last moved. Anything quiet for STALL_MS is
   * dropped and asked for again.
   */
  private receiving = new Map<string, Receiving>();
  private render: RenderState | null = null;
  private worker: Worker | null = null;
  /** This take's ink in take time, saved to ink.json: it can grow, so it stays out of the manifest. */
  private inkLog: Record<string, InkStroke> = {};
  private inkSave: ReturnType<typeof setTimeout> | null = null;

  // Ink (everyone): strokes on the current stage, times on our clock.
  private ink = new Map<string, InkStroke>();
  /** What's on stage, as ink sees it (a cut clears the ink): 'empty', 'end', or 'id:cam' / 'id:screen'. */
  private inkStage = 'empty';
  /** Our ink colour, a slot in INK_COLORS (claimInk). */
  inkSlot = 0;
  private pen: { id: string; stroke: InkStroke; out: InkPoint[]; timer: ReturnType<typeof setInterval> } | null = null;

  /** This take's reactions in take time, saved to reactions.json, and each emoji's animation as it's saved next to it. */
  private reactLog: Reaction[] = [];
  /** When we last sent each emoji, for NAME_COOLDOWN_MS. */
  private lastSent = new Map<string, number>();
  private reactSave: ReturnType<typeof setTimeout> | null = null;
  private lottieSaves = new Map<string, Promise<void>>();
  // Reactions (everyone): in the air or about to be, times on our clock.
  private reactions = new Map<string, Reaction>();
  private reactWatchers = new Set<() => void>();

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
    this.watchFace();
    this.refreshDevices();
    castSupport().then((c) => {
      this.cast = c;
      this.announce();
    });
    navigator.mediaDevices.addEventListener?.('devicechange', () => this.refreshDevices());
    await this.restore();
    this.timers.push(setInterval(() => this.pingAll(), 5000));
    this.timers.push(setInterval(() => this.directorTick(), 500));
    this.timers.push(setInterval(() => this.reofferFiles(), REOFFER_MS));
    this.timers.push(setInterval(() => this.forwardXlog(), 2000));
    document.addEventListener('visibilitychange', () => (this.uploading || this.receiving.size) && this.xlog.add(tabState()));
    window.addEventListener('pagehide', () => this.mesh.broadcast({ t: 'bye' }));
    await this.mesh.start();
  }

  async leave() {
    this.timers.forEach(clearInterval);
    this.faceWatch.stop();
    // Camera, mic and screen first: disconnecting from signaling can take a
    // moment, and the camera light shouldn't wait for it.
    this.cam?.getTracks().forEach((t) => t.stop());
    this.screen?.getTracks().forEach((t) => t.stop());
    this.caster?.stop();
    this.views.forEach((v) => v.close());
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
        this.inkLog = (await fs.readJson<Record<string, InkStroke>>(takeId, 'ink.json')) ?? {};
        this.reactLog = (await fs.readJson<Reaction[]>(takeId, 'reactions.json')) ?? [];
        for (const r of this.reactLog) this.saveLottie(takeId, r.cp);
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
        screen: !p?.hasScreen ? null : this.viaCast(link.peer) ? this.viewFor(link.peer).stream : (p.screenStreamId && link.remoteStreams.get(p.screenStreamId)) || null,
        route: link.route,
      });
    }
    for (const [id, v] of this.views) {
      if (peers.get(id)?.screen === v.stream) continue;
      v.close();
      this.views.delete(id);
    }
    const tiles = this.tiles(peers);
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
      head: this.head,
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
      tiles,
      strip: this.strip(tiles),
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
      transferLogs: this.transferLogs(),
      notice: this.notice,
    };
  }

  private tiles(peers: Map<PeerId, PeerView>) {
    const present = new Set([this.me, ...peers.keys()]);
    const order = this.shared.order.v.filter((id) => present.has(id));
    const rest = [...present].filter((id) => !order.includes(id)).sort();
    return [...order, ...rest];
  }

  /** The tiles plus Multicam, after as many of them as it followed when it was last placed (default: last). */
  private strip(tiles: PeerId[]): (PeerId | 'end')[] {
    const v = this.shared.order.v;
    const at = v.indexOf('end');
    if (at < 0) return [...tiles, 'end'];
    const n = v.slice(0, at).filter((id) => tiles.includes(id)).length;
    return [...tiles.slice(0, n), 'end', ...tiles.slice(n)];
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
    if (key === 'stage') this.onInkStage();
    this.changed();
  }

  // ------------------------------------------------------------------ links

  private attach(link: Link) {
    const peer = link.peer;
    let greeted = false;
    link.on('message', (m) => this.onMessage(peer, link, m));
    link.on('stream', () => this.changed());
    link.on('fileChannel', (ch) => this.receiveFile(peer, ch));
    link.on('screenData', (buf) => this.viaCast(peer) && this.viewFor(peer).receive(buf));
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
      this.updateCast();
      this.changed();
    });
    link.pc.addEventListener('signalingstatechange', () => link.pc.signalingState === 'stable' && this.applyEncodings(link));
    link.pc.addEventListener('connectionstatechange', () => {
      if (this.transfersWith(peer)) this.xlog.add(`link to ${this.nameOf(peer)}: ${link.pc.connectionState}`);
    });
    if (this.transfersWith(peer)) this.xlog.add(`link to ${this.nameOf(peer)}: new connection`);
    this.pushTracks(link);
  }

  private presence(): Presence {
    return {
      profile: this.profile,
      hasScreen: !!this.screen,
      micMuted: this.micMuted,
      camOff: this.camOff,
      head: this.head,
      camStreamId: this.cam?.id ?? null,
      screenStreamId: this.screen?.id ?? null,
      castRx: this.cast.receive,
      screenCast: !!this.caster,
      ink: this.inkSlot,
    };
  }

  /**
   * Everyone's ink gets its own colour. We keep ours unless someone with a
   * smaller id holds it too; then we move to the least-used one. They settle
   * the same way, so nobody shares a colour while there are colours spare.
   */
  private claimInk() {
    const others = this.mesh.openLinks().flatMap((l) => {
      const p = this.presences.get(l.peer);
      return p?.ink === undefined ? [] : [{ peer: l.peer, c: p.ink }];
    });
    if (!others.some((o) => o.c === this.inkSlot && o.peer < this.me)) return;
    const used = INK_COLORS.map((_, c) => others.filter((o) => o.c === c).length);
    this.inkSlot = used.indexOf(Math.min(...used));
    this.announce();
  }

  private announce() {
    this.mesh.broadcast({ t: 'hello', presence: this.presence() });
    this.changed();
  }

  private onMessage(peer: PeerId, link: Link, m: any) {
    switch (m.t) {
      case 'hello': {
        const castRx = !!this.presences.get(peer)?.castRx;
        this.presences.set(peer, m.presence);
        // They can (or no longer can) take our screen encoded-once: switch how it's sent.
        if (this.screen && castRx !== !!m.presence.castRx) {
          this.pushTracks(link);
          this.applyEncodings(link);
        }
        if (this.dm && this.active) this.dm.profiles[peer] = m.presence.profile;
        this.claimInk();
        this.changed();
        break;
      }
      case 'scr-key':
        this.caster?.requestKey(peer);
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
        this.dmOnFiles(peer, link, m.takeId, m.files, m.report, m.camOff, m.frames, m.canCut === true);
        break;
      case 'cut':
        this.onCut(m.takeId, m.spans);
        break;
      case 'want': {
        this.xlog.add(`${m.name}: the director asks for it from ${mb(m.offset)}`);
        // A file we no longer have (trimmed and renamed, see cut.ts): tell the
        // director what we do have instead of failing on every request.
        const mine = this.mine.get(m.takeId);
        if (mine && !mine.files.some((f) => f.name === m.name && f.size > 0)) {
          this.xlog.add(`${m.name}: not here any more; offering the current files`);
          this.offerFiles(m.takeId);
          break;
        }
        // The latest request for a file wins: the director drops a stalled
        // transfer before asking again, from the offset it has on disk.
        this.uploadQueue = this.uploadQueue.filter((j) => j.takeId !== m.takeId || j.name !== m.name);
        this.uploadQueue.push({ takeId: m.takeId, name: m.name, offset: m.offset });
        this.pumpUploads();
        break;
      }
      case 'ack':
        this.onAck(m.takeId, m.name);
        break;
      case 'xlog':
        if (this.dm) {
          const lines = this.peerXlogs.get(peer) ?? [];
          lines.push(...(m.lines as string[]).map(String));
          if (lines.length > 3000) lines.splice(0, lines.length - 3000);
          this.peerXlogs.set(peer, lines);
          this.changed();
        }
        break;
      case 'rename':
        this.setProfile(m.profile);
        saveProfile(m.profile);
        break;
      case 'mute':
        // Anyone can mute anyone; only you can unmute yourself.
        if (!this.micMuted) {
          this.toggleMic();
          this.say(`${this.nameOf(peer)} muted you.`);
        }
        break;
      case 'race':
        this.race = { takeId: m.takeId, rows: m.rows };
        this.changed();
        break;
      case 'ink':
        this.onInk(peer, m);
        break;
      case 'react':
        this.onReact(peer, m);
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
    if (screen && this.screen && !this.castsTo(link.peer)) tracks.push({ role: 'screen', track: screen, stream: this.screen, enc: screenEncoding(screen, this.screenOnStage()) });
    link.setTracks(tracks);
  }

  private pushAll() {
    for (const l of this.mesh.links.values()) this.pushTracks(l);
    this.applyEncodings();
  }

  private camRole(): CamRole {
    const s = this.shared.stage.v;
    // While we upload a take, our camera goes out at thumbnail quality so the upload gets the bandwidth.
    if (!s || this.owesFiles()) return 'tile';
    if (s.kind === 'end') return 'grid';
    if (s.id !== this.me) return 'tile';
    return s.view === 'cam' || !this.screen ? 'stage' : 'tile';
  }

  /** We have finished-take files the director hasn't confirmed yet. */
  private owesFiles() {
    for (const m of this.mine.values()) if (m.take.director !== this.me && m.complete && !this.purged.has(m.take.id) && m.files.some((f) => f.size > 0 && !m.acked.includes(f.name))) return true;
    return false;
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
    this.updateCast();
  }

  /** Our screen goes encoded-once to this peer (else as a WebRTC track). */
  private castsTo(peer: PeerId) {
    return !!this.caster && !!this.presences.get(peer)?.castRx;
  }

  /** This peer's screen reaches us encoded-once. */
  private viaCast(peer: PeerId) {
    return this.cast.receive && !!this.presences.get(peer)?.screenCast;
  }

  private viewFor(peer: PeerId) {
    let v = this.views.get(peer);
    if (!v) {
      v = new ScreenView(() => this.mesh.links.get(peer)?.send({ t: 'scr-key' }));
      this.views.set(peer, v);
    }
    return v;
  }

  /** Who gets our encoded screen, and whether it's worth encoding (only while it's on stage). */
  private updateCast() {
    if (!this.caster) return;
    const channels = new Map<string, RTCDataChannel>();
    for (const l of this.mesh.openLinks()) if (this.castsTo(l.peer)) channels.set(l.peer, l.scr);
    this.caster.update(channels, this.screenOnStage());
  }

  async toggleScreen() {
    if (this.screen) {
      this.stopScreen();
      return;
    }
    try {
      const s = await openScreen();
      this.screen = s;
      const track = s.getVideoTracks()[0];
      const screenNote = (what: string) => {
        console.info(`[screen] ${what}`);
        this.note(this.active?.take.id ?? '', `screen: ${what}`);
      };
      track?.addEventListener('ended', () => {
        screenNote("share ended (window or tab closed, or Chrome's Stop sharing)");
        if (this.screen === s) this.stopScreen();
      });
      let gone: ReturnType<typeof setTimeout> | null = null;
      track?.addEventListener('mute', () => {
        screenNote('no longer sending (muted)');
        gone ??= setTimeout(() => {
          gone = null;
          if (this.screen !== s || !track.muted) return;
          screenNote(`still muted after ${SCREEN_GONE_MS / 1000} s: treated as closed, sharing stopped`);
          this.say('Your shared window closed or stopped sending, so screen sharing stopped.');
          this.stopScreen();
        }, SCREEN_GONE_MS);
      });
      track?.addEventListener('unmute', () => {
        screenNote('sending again (unmuted)');
        if (gone) clearTimeout(gone);
        gone = null;
      });
      if (track && (await castSupport()).send && this.screen === s) {
        try {
          this.caster = new ScreenCaster(track);
        } catch (e) {
          console.warn('[screencast] unavailable, sending the screen as a track', e);
        }
      }
      this.pushAll();
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
    this.caster?.stop();
    this.caster = null;
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
    this.watchFace();
    this.pushAll();
    this.announce();
  }

  // ------------------------------------------------------------------ auto-framing

  /** Follow the current camera track; when it's off, the last framing stays. */
  private watchFace() {
    this.faceWatch.setTrack(this.camOff ? null : (this.cam?.getVideoTracks()[0] ?? null));
  }

  /** A new framing anchor: share it, and log it into the take for the final cut. */
  private onHead(h: Head | null) {
    this.head = h;
    const a = this.active;
    const m = a && this.mine.get(a.take.id);
    if (a && m && !m.complete) (m.frames ??= []).push([this.toTake(a.take, now()), h]);
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
      if (kind === 'cam') {
        rec?.setVideo?.(t);
        this.watchFace();
      } else rec?.setAudio?.(t);
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

  /** Anyone can mute anyone (not unmute: that's theirs to do). */
  muteOf(id: PeerId) {
    if (id === this.me) return !this.micMuted && this.toggleMic();
    this.mesh.links.get(id)?.send({ t: 'mute' });
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

  reorder(order: (PeerId | 'end')[]) {
    if (this.takeLocked()) return this.say('Tiles are locked while recording.');
    this.set('order', order);
  }

  /** Anyone can make anyone (or nobody) the director, except while recording. */
  setDirector(id: PeerId | null) {
    if (this.takeLocked()) return this.say("The Shōgun (director) can't change while recording.");
    this.set('director', id);
    // The director's tile always leads the strip.
    if (id) this.set('order', [id, ...this.snapshot.strip.filter((x) => x !== id)]);
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
      this.inkLog = {};
      this.reactLog = [];
      this.lottieSaves.clear();
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
    if (!this.mine.has(take.id)) this.mine.set(take.id, { take, files: [], acked: [], complete: false, camOff: this.camOff ? [[-PREROLL_MS, null]] : [], frames: [[-PREROLL_MS, this.head]] });
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
      // On disk before the render can start.
      if (this.inkSave) clearTimeout(this.inkSave), (this.inkSave = null);
      if (Object.keys(this.inkLog).length) await fs.writeJson(take.id, 'ink.json', this.inkLog).catch(() => {});
      if (this.reactSave) clearTimeout(this.reactSave), (this.reactSave = null);
      if (this.reactLog.length) await fs.writeJson(take.id, 'reactions.json', this.reactLog).catch(() => {});
      await Promise.all(this.lottieSaves.values());
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
        (this.dm.frames ??= {})[this.me] = m.frames ?? [];
        this.dm.finishedAt[this.me] = now();
        this.saveDm();
      }
    } else {
      this.offerFiles(take.id);
      this.applyEncodings();
    }
    this.changed();
  }

  // ------------------------------------------------------------------ transfer log

  private nameOf(peer: PeerId) {
    return this.presences.get(peer)?.profile.name || this.dm?.profiles[peer]?.name || peer;
  }

  /** Files are moving (or owed) between us and `peer`, either way. */
  private transfersWith(peer: PeerId) {
    if (this.dm) return Object.values(this.dm.files).some((f) => f.peer === peer && !f.done);
    for (const m of this.mine.values()) if (m.take.director === peer && m.complete && !this.purged.has(m.take.id) && m.files.some((f) => f.size > 0 && !m.acked.includes(f.name))) return true;
    return false;
  }

  /** Guests send new log lines to the director of their latest take, so its copy has both ends. */
  private forwardXlog() {
    const director = [...this.mine.values()].at(-1)?.take.director;
    if (!director || director === this.me) return;
    const link = this.mesh.links.get(director);
    if (!link?.open) return; // kept until it's back
    const lines = this.xlog.takeUnsent();
    if (lines.length) link.send({ t: 'xlog', lines });
  }

  private transferLogs() {
    const out = this.xlog.lines.length ? [{ who: this.profile.name || 'You', lines: [...this.xlog.lines] }] : [];
    for (const [peer, lines] of this.peerXlogs) out.push({ who: this.nameOf(peer), lines: [...lines] });
    return out;
  }

  // ------------------------------------------------------------------ uploads (non-director)

  private offerFiles(takeId: string) {
    const m = this.mine.get(takeId);
    if (!m || !m.complete) return;
    const link = this.mesh.links.get(m.take.director);
    if (!link?.open) return; // retried when the director (re)connects
    // canCut: we trim our files to the edit when the director says what it shows (cut.ts).
    link.send({ t: 'files', takeId, files: m.files.filter((f) => f.size > 0), report: m.report ?? [], camOff: m.camOff ?? [], frames: m.frames ?? [], canCut: true });
  }

  /** The director says what of each file the edit shows: trim them (once), then offer them again. */
  private onCut(takeId: string, spans: Record<string, Span[]>) {
    const m = this.mine.get(takeId);
    if (!m?.complete || this.cutting.has(takeId) || m.take.director === this.me) return;
    this.cutting.set(
      takeId,
      this.cutFiles(m, spans).finally(() => this.cutting.delete(takeId)),
    );
  }

  private async cutFiles(m: SenderManifest, spans: Record<string, Span[]>) {
    const dir = await fs.takeDir(m.take.id);
    for (const f of m.files) {
      if (f.cut || !f.size || m.acked.includes(f.name)) continue;
      const keep = spans[f.name];
      if (!keep || !cuttable(f)) {
        f.cut = true; // goes as it is
        continue;
      }
      const began = performance.now();
      const src = await (await dir.getFileHandle(f.name)).getFile();
      if (testHook('keepUncut')) await fs.keepCopy(f.name, src); // test: keep the original to examine
      if (f.kind === 'screen' && !keep.length) {
        // Never on stage: nothing to send.
        this.xlog.add(`${f.name}: never on stage, not sent (saves ${mb(src.size)})`);
        await fs.removeFile(m.take.id, f.name);
        Object.assign(f, { size: 0, cut: true });
        continue;
      }
      const name = f.name.replace(/(\.\w+)$/, '-cut$1');
      try {
        const out = await (await dir.getFileHandle(name, { create: true })).createWritable();
        const r = await cutRecording(src, keep, out as unknown as WritableStream);
        const cut = await (await dir.getFileHandle(name)).getFile();
        // Never upload a cut that would put frames at the wrong time.
        const wrong = (await verifyCut(cut, r.stamps)) ?? (await verifyAgainstSource(src, r));
        if (wrong) throw new Error(`the cut file's timing differs: ${wrong}`);
        const size = cut.size;
        await fs.removeFile(m.take.id, f.name);
        const secs = ((performance.now() - began) / 1000).toFixed(1);
        const list = (s: Span[]) => s.map(([a, b]) => `${a.toFixed(2)}–${b.toFixed(2)}`).join(', ') || 'none';
        this.xlog.add(`${f.name}: cut to the edit: ${r.videoSeconds.toFixed(1)} s of video${f.kind === 'cam' ? ' + all its audio' : ''}, ${mb(src.size)} → ${mb(size)} in ${secs} s · asked ${list(keep)} · kept ${list(r.kept)}`);
        Object.assign(f, { name, size, cut: true });
      } catch (e) {
        this.xlog.add(`FAILED cutting ${f.name} (${e}); sending it whole`);
        await fs.removeFile(m.take.id, name);
        f.cut = true;
      }
    }
    await fs.writeJson(m.take.id, 'mine.json', m);
    this.offerFiles(m.take.id);
    this.changed();
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
    const chunk = Math.min(MAX_CHUNK, link.pc.sctp?.maxMessageSize || SAFE_CHUNK);
    this.xlog.add(`${name}: sending ${mb(file.size - offset)} from ${mb(offset)} of ${mb(file.size)} · ${chunk / 1024} KB messages · ${tabState()}`);
    const began = Date.now();
    const ch = link.pc.createDataChannel(`f:${takeId}:${name}:${offset}`, { ordered: true });
    ch.binaryType = 'arraybuffer';
    ch.bufferedAmountLowThreshold = LOW_WATER;
    // Closing a peer connection doesn't fire 'close' on its data channels, and a
    // newer request for this file supersedes this one, so every wait also
    // checks for those, and gives up when nothing moves for STALL_MS (a dead
    // upload would otherwise block the queue). The director asks again.
    const superseded = () => this.uploadQueue.some((j) => j.takeId === takeId && j.name === name);
    const dead = () => ch.readyState === 'closing' || ch.readyState === 'closed' || ['closed', 'failed'].includes(link.pc.connectionState) || superseded();
    const why = () => (superseded() ? 'asked for again' : `channel ${ch.readyState}, link ${link.pc.connectionState}`);
    const until = (ready: () => boolean, what: string, progress = () => 0) =>
      new Promise<void>((res, rej) => {
        let seen = progress();
        let moved = Date.now();
        const check = () => {
          if (ready()) return done(res);
          if (dead()) return done(() => rej(new Error(`upload channel closed (${what}; ${why()})`)));
          const p = progress();
          if (p !== seen) (seen = p), (moved = Date.now());
          if (Date.now() - moved > STALL_MS) done(() => rej(new Error(`upload stalled (${what}; nothing moved for ${STALL_MS / 1000} s)`)));
        };
        // Events answer straight away (also in a background tab, where timers
        // slow to once a second); the timer catches deaths that fire no event.
        const timer = setInterval(check, 1000);
        const done = (f: () => void) => {
          clearInterval(timer);
          ch.removeEventListener('bufferedamountlow', check);
          ch.removeEventListener('open', check);
          ch.removeEventListener('close', check);
          f();
        };
        ch.addEventListener('bufferedamountlow', check);
        ch.addEventListener('open', check);
        ch.addEventListener('close', check);
        check();
      });
    let pos = offset;
    const sentOut = () => pos - ch.bufferedAmount; // grows as the channel hands bytes to the network
    // Refills: how long we wait for the queue to drain, and how often it had
    // run dry by the time we woke (the link sat idle waiting on this tab).
    const refill = { n: 0, ms: 0, dry: 0 };
    const refillStats = () => `${refill.n} refills, ${(refill.ms / 1000).toFixed(1)} s waiting, empty on waking ${refill.dry}×`;
    let last = { bytes: offset, at: Date.now() };
    const sampler = setInterval(async () => {
      const at = Date.now();
      const bytes = sentOut();
      const rate = ((bytes - last.bytes) * 1000) / (at - last.at);
      last = { bytes, at };
      const pct = Math.floor((bytes / file.size) * 100);
      this.xlog.add(`${name}: ${pct}% ${mb(bytes)} · ${fmtRate(rate)} · queued ${mb(ch.bufferedAmount)} · ${refillStats()} · ${tabState()} · ${await linkStats(link.pc)}`);
    }, SAMPLE_MS);
    let probe: StallProbe | null = null;
    const explain = (why: string) => {
      const lines = probe?.dump() ?? [];
      if (lines.length) this.xlog.add(`${name}: the last ${lines.length} s before ${why}:`);
      lines.forEach((l) => this.xlog.add(l));
    };
    try {
      await until(() => ch.readyState === 'open', 'opening');
      probe = new StallProbe(link.pc, ch, 'send', () => `our other channels: control ${mb(link.ctl.bufferedAmount)}, screen ${mb(link.scr.bufferedAmount)} queued`);
      this.xlog.add(`${name}: channel open after ${Date.now() - began} ms · ${await linkStats(link.pc)}`);
      this.upload.set(key, { sent: pos, total: file.size });
      const read = (at: number) => file.slice(at, at + BLOCK).arrayBuffer();
      let readTo = pos; // `pos` counts what's handed to the channel, message by message
      let next = read(readTo);
      while (pos < file.size) {
        if (pos > 0 && pos >= (testHook('freezeUploadAt') ?? Infinity)) {
          // Test: go silent mid-file, channel open, no error (a frozen upload).
          localStorage.removeItem('samurai:test:freezeUploadAt');
          await new Promise<void>((res) => {
            const t = setInterval(() => dead() && (clearInterval(t), res()), 200);
          });
          throw new Error('upload channel closed (test freeze)');
        }
        const block = await next;
        readTo += block.byteLength;
        // Read the next block from disk while this one goes out.
        if (readTo < file.size) (next = read(readTo)).catch(() => {});
        for (let i = 0; i < block.byteLength; i += chunk) {
          if (ch.bufferedAmount > HIGH_WATER) {
            const t = performance.now();
            await until(() => ch.bufferedAmount <= LOW_WATER, 'sending', sentOut);
            refill.n++;
            refill.ms += performance.now() - t;
            if (ch.bufferedAmount === 0) refill.dry++;
          }
          if (dead()) throw new Error(`upload channel closed (sending; ${why()})`);
          ch.send(block.slice(i, i + chunk));
          pos += Math.min(chunk, block.byteLength - i);
        }
        this.upload.set(key, { sent: pos - ch.bufferedAmount, total: file.size });
        this.changed();
      }
      ch.send('eof');
      this.xlog.add(`${name}: all queued; the director closes the channel once it's saved`);
      // The director closes the channel after it has flushed the file to disk.
      const closed = await until(() => ch.readyState === 'closed', 'finishing', () => ch.bufferedAmount).then(
        () => true,
        (e) => (this.xlog.add(`${name}: no close from the director, ${mb(ch.bufferedAmount)} still queued (${e.message}); it asks again`), explain('giving up'), false),
      );
      const secs = (Date.now() - began) / 1000;
      if (closed) this.xlog.add(`${name}: finished ${mb(file.size - offset)} in ${secs.toFixed(1)} s · ${fmtRate((file.size - offset) / secs)} average · ${refillStats()} · ${tabState()}`);
    } catch (e) {
      this.xlog.add(`FAILED ${name} at ${mb(sentOut())} of ${mb(file.size)}: ${(e as Error).message}. The director asks again from what it saved.`);
      explain('it failed');
      throw e;
    } finally {
      probe?.stop();
      clearInterval(sampler);
      if (ch.readyState !== 'closed') ch.close();
    }
  }

  /**
   * Safety net: every so often, re-offer files the director hasn't confirmed.
   * The director ignores offers for files that are arriving fine and asks
   * again for the rest, so a lost request or confirmation can't strand one.
   */
  private reofferFiles() {
    for (const m of this.mine.values()) {
      if (m.take.director === this.me || !m.complete || this.purged.has(m.take.id)) continue;
      if (m.files.some((f) => f.size > 0 && !m.acked.includes(f.name))) this.offerFiles(m.take.id);
    }
  }

  private async onAck(takeId: string, name: string) {
    const m = this.mine.get(takeId);
    // A returning director re-confirms files we've already cleaned up.
    if (!m || this.purged.has(takeId)) return;
    if (!m.acked.includes(name)) m.acked.push(name), this.xlog.add(`${name}: the director has it`);
    if (m.complete && m.files.every((f) => f.size === 0 || m.acked.includes(f.name))) {
      // Director has everything: free the disk space.
      this.purged.add(takeId);
      await fs.removeTake(takeId);
    } else {
      await fs.writeJson(takeId, 'mine.json', m).catch(() => {});
    }
    this.applyEncodings();
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

  private async dmOnFiles(peer: PeerId, link: Link, takeId: string, files: RecFile[], report?: string[], camOff?: [number, number | null][], frames?: [number, Head | null][], canCut = false) {
    const dm = this.dm;
    if (dm?.take.id !== takeId) {
      // Not our take (or already discarded): tell them to let it go.
      for (const f of files) link.send({ t: 'ack', takeId, name: f.name });
      return;
    }
    // Our own recording may still be finishing, with the take's stop time not
    // yet in our manifest: it's already in the shared state. Without it the
    // edit (and what to trim) isn't known yet: wait for the next offer.
    const shared = this.shared.take.v;
    if (!dm.take.stopAt && shared?.id === takeId && shared.stopAt) dm.take = shared;
    if (!dm.take.stopAt) return;
    if (!dm.expected.includes(peer)) dm.expected.push(peer);
    if (report) (dm.reports ??= {})[peer] = report;
    if (camOff) (dm.camOff ??= {})[peer] = camOff;
    if (frames) (dm.frames ??= {})[peer] = frames;
    // Guests that can trim send only what the edit shows: say what that is, and
    // wait for the trimmed offer before counting them in (or the render could
    // start without their files).
    const uncut = canCut ? files.filter((f) => !f.cut && cuttable(f)) : [];
    if (uncut.length) {
      const spans: Record<string, Span[]> = {};
      for (const f of uncut) spans[f.name] = mergeSpans(shownSpans(dm, peer, f.kind)).map(([a, b]) => [Math.max(0, a - f.offset / 1000), b - f.offset / 1000]);
      if (!this.cutAsked.has(peer)) {
        this.cutAsked.add(peer);
        const shown = (k: 'cam' | 'screen') => mergeSpans(shownSpans(dm, peer, k)).reduce((a, [x, y]) => a + y - x, 0).toFixed(0);
        this.xlog.add(`asked ${this.nameOf(peer)} to trim to the edit: camera ${shown('cam')} s, screen ${shown('screen')} s (padded), of a ${(((dm.take.stopAt ?? 0) - dm.take.startAt) / 1000).toFixed(0)} s take`);
      }
      link.send({ t: 'cut', takeId, spans });
      this.saveDm();
      return;
    }
    if (!dm.announced.includes(peer)) dm.announced.push(peer);
    // An offer lists all of a guest's files: anything of theirs not in it any
    // more (a file they trimmed and renamed) isn't coming.
    for (const [name, f] of Object.entries(dm.files)) {
      if (f.peer !== peer || f.done || files.some((x) => x.name === name)) continue;
      this.xlog.add(`${name}: no longer offered by ${this.nameOf(peer)}; not waiting for it`);
      void this.receiving.get(name)?.stop?.();
      this.receiving.delete(name);
      delete dm.files[name];
      void fs.removeFile(takeId, name);
    }
    for (const f of files) {
      const have = dm.files[f.name];
      if (have?.done) {
        link.send({ t: 'ack', takeId, name: f.name });
        continue;
      }
      if (have && this.receiving.has(f.name)) continue; // in hand; the watchdog restarts it if it stalls
      const onDisk = await fs.fileSize(takeId, f.name);
      if (this.receiving.has(f.name)) continue; // asked for while we looked
      dm.files[f.name] = { ...f, peer, received: Math.min(onDisk, f.size), done: false };
      this.want(link, f.name);
    }
    this.saveDm();
    this.directorTick();
  }

  private want(link: Link, name: string) {
    const dm = this.dm!;
    this.receiving.set(name, { ch: null, at: Date.now() });
    const f = dm.files[name];
    this.xlog.add(`asked ${this.nameOf(link.peer)} for ${name} from ${mb(f.received)} of ${mb(f.size)}`);
    link.send({ t: 'want', takeId: dm.take.id, name, offset: f.received });
  }

  /**
   * Restarts transfers that stopped moving: closes the channel, waits for what
   * did arrive to reach disk, then asks again from there. Also asks for files
   * nobody is sending (a failed transfer, a short file at 'eof').
   */
  private watchTransfers() {
    const dm = this.dm!;
    for (const f of Object.values(dm.files)) {
      if (f.done || f.peer === this.me) continue;
      const link = this.mesh.links.get(f.peer);
      if (!link?.open) continue; // they re-offer when they reconnect
      const r = this.receiving.get(f.name);
      // Before any bytes (or the channel) arrive: STALL_MS. Once they flow, sooner (stallAfter).
      const moved = r?.began !== undefined && f.received > r.from!;
      const limit = moved ? stallAfter(((f.received - r!.from!) * 1000) / Math.max(1, r!.at - r!.began!)) : STALL_MS;
      if (r && Date.now() - r.at < limit) continue;
      if (r?.stop) {
        this.xlog.add(`STALLED ${f.name}: nothing for ${(limit / 1000).toFixed(1)} s at ${mb(f.received)} of ${mb(f.size)}; asking again`);
        this.explainStall(f.name, r);
        console.warn(`[upload] ${f.name} stalled at ${f.received} of ${f.size} bytes; asking again`);
        r.at = Date.now(); // not again while it winds down
        const stop = r.stop;
        r.stop = undefined;
        stop().then(() => this.dm === dm && !f.done && this.want(link, f.name));
      } else {
        if (r) this.xlog.add(`${f.name}: no channel ${STALL_MS / 1000} s after asking; asking again`);
        this.want(link, f.name);
      }
    }
  }

  /** Logs the receiving side's last seconds of a transfer that went wrong (see StallProbe). */
  private explainStall(name: string, r: Receiving) {
    const lines = r.probe?.dump() ?? [];
    if (!lines.length) return;
    this.xlog.add(`${name}: the last ${lines.length} s, receiving side:`);
    lines.forEach((l) => this.xlog.add(l));
  }

  /** Every SAMPLE_MS: each arriving file's speed, unsaved backlog and connection. */
  private async sampleReceiving() {
    const dm = this.dm;
    if (!dm) return;
    for (const [name, r] of this.receiving) {
      const f = dm.files[name];
      if (!f || !r.ch || !r.writer) continue;
      const at = Date.now();
      const prev = (r.sample ??= { bytes: r.from ?? 0, at: r.began ?? at });
      if (at - prev.at < SAMPLE_MS) continue;
      const rate = ((f.received - prev.bytes) * 1000) / (at - prev.at);
      r.sample = { bytes: f.received, at };
      const link = this.mesh.links.get(f.peer);
      const stats = link ? await linkStats(link.pc) : 'no link';
      this.xlog.add(`${name}: ${Math.floor((f.received / f.size) * 100)}% ${mb(f.received)} · ${fmtRate(rate)} · not yet on disk ${mb(r.writer.backlog)} · ${stats}`);
    }
  }

  private receiveFile(peer: PeerId, ch: RTCDataChannel) {
    const [, takeId, name, from] = ch.label.split(':');
    const dm = this.dm;
    const f = dm?.files[name];
    const r = this.receiving.get(name);
    // Only the channel we asked for, starting where our file ends: not a late
    // one from an earlier request.
    if (!dm || dm.take.id !== takeId || !f || f.peer !== peer || f.done || !r || r.ch || Number(from) !== f.received) {
      if (dm?.take.id === takeId) this.xlog.add(`${name}: ignored a channel from ${mb(Number(from))} (have ${f ? mb(f.received) : 'nothing'}${r?.ch ? ', another is open' : ''})`);
      return ch.close();
    }
    ch.binaryType = 'arraybuffer';
    r.ch = ch;
    r.at = r.began = Date.now();
    r.from = f.received;
    const writer = (r.writer = new InPlaceWriter(takeId, name, f.received));
    const link = this.mesh.links.get(peer);
    if (link) r.probe = new StallProbe(link.pc, ch, 'receive', () => `not yet on disk ${mb(writer.backlog)}`);
    this.xlog.add(`${name}: receiving from ${this.nameOf(peer)} at ${mb(f.received)} of ${mb(f.size)} · ${tabState()}`);
    let base = f.received;
    let ended: Promise<void> | null = null;
    // Ends this transfer once: whatever arrived is flushed to disk and counted.
    const end = () =>
      (ended ??= (async () => {
        ch.onmessage = null;
        r.probe?.stop();
        await writer.close();
        f.received = Math.min(writer.written, f.size);
        if (writer.written > f.size || writer.failed) {
          // Can't trust it: start over.
          this.xlog.add(`FAILED saving ${name} at ${mb(writer.written)}: ${writer.failed ?? 'longer than announced'}; starting the file over`);
          f.received = 0;
        }
        if (this.receiving.get(name) === r) this.receiving.delete(name);
        if (ch.readyState !== 'closed') ch.close();
        this.saveDm();
      })());
    r.stop = end;
    ch.onmessage = (e) => {
      r.at = Date.now();
      if (typeof e.data === 'string') {
        if (e.data !== 'eof') return;
        end().then(() => {
          f.done = f.received === f.size;
          const secs = (Date.now() - r.began!) / 1000;
          // Short (a lost chunk): the watchdog asks for the rest straight away.
          if (!f.done) {
            this.xlog.add(`${name} ended short: ${mb(f.received)} of ${mb(f.size)}; asking for the rest`);
            this.explainStall(name, r);
            return console.warn(`[upload] ${name} ended short: ${f.received} of ${f.size} bytes`);
          }
          this.xlog.add(`${name}: saved, ${mb(f.size - r.from!)} in ${secs.toFixed(1)} s · ${fmtRate((f.size - r.from!) / secs)} average · ${tabState()}`);
          this.mesh.links.get(peer)?.send({ t: 'ack', takeId, name });
          this.checkPeerDone(peer);
          this.saveDm();
        });
        return;
      }
      base += e.data.byteLength;
      f.received = Math.min(base, f.size);
      writer.write(e.data);
    };
    ch.onclose = () => {
      if (!ended) {
        this.xlog.add(`${name}: channel closed at ${mb(f.received)} of ${mb(f.size)} (link ${this.mesh.links.get(peer)?.pc.connectionState ?? 'gone'})`);
        this.explainStall(name, r);
      }
      void end();
    };
  }

  /** A guest's arrival speed, smoothed over a few seconds. */
  private raceRate(peer: PeerId, bytes: number) {
    const at = Date.now();
    const r = this.raceRates.get(peer);
    if (!r || bytes < r.bytes) return void this.raceRates.set(peer, { bytes, at, rate: 0 });
    if (at - r.at < 2000) return r.rate;
    const rate = ((bytes - r.bytes) * 1000) / (at - r.at);
    this.raceRates.set(peer, { bytes, at, rate: r.rate ? r.rate * 0.5 + rate * 0.5 : rate });
    return this.raceRates.get(peer)!.rate;
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
    this.watchTransfers();
    void this.sampleReceiving();
    const rows: RaceRow[] = dm.expected
      .filter((p) => p !== this.me)
      .map((peer) => {
        const files = Object.values(dm.files).filter((f) => f.peer === peer);
        const announced = dm.announced.includes(peer);
        const received = files.reduce((a, f) => a + f.received, 0);
        const done = announced && files.every((f) => f.done);
        return {
          peer,
          name: dm.profiles[peer]?.name || 'Guest',
          received,
          total: files.reduce((a, f) => a + f.size, 0),
          announced,
          done,
          finishedAt: dm.finishedAt[peer],
          rate: done ? undefined : this.raceRate(peer, received),
        };
      });
    this.race = { takeId: dm.take.id, rows };
    this.mesh.broadcast({ t: 'race', takeId: dm.take.id, rows });
    // Senders that reconnected after a drop re-offer their files themselves (see attach).
    // Starts once by itself; after an error it waits for "Try again" (it would only fail the same way).
    if (rows.every((r) => r.done) && dm.announced.includes(this.me) && (!this.render || this.render.state === 'waiting')) this.startRender();
    this.changed();
  }

  // ------------------------------------------------------------------ director: render

  startRender() {
    const dm = this.dm;
    if (!dm || !dm.take.stopAt || this.render?.state === 'rendering') return;
    this.render = { state: 'rendering', progress: 0, speed: 0 };
    (dm.reports ??= {}).render = []; // this attempt's report only
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
    // Let go of files still arriving, so they can be deleted.
    await Promise.all([...this.receiving.values()].map((r) => r.stop?.()));
    this.receiving.clear();
    this.raceRates.clear();
    this.peerXlogs.clear();
    this.cutAsked.clear();
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

  // ------------------------------------------------------------------ ink

  /** Ink belongs to what's on stage when it's drawn (a screen, a camera, the end screen, or nothing): a cut clears it. */
  private onInkStage() {
    const st = this.shared.stage.v;
    const key = !st ? 'empty' : st.kind === 'end' ? 'end' : `${st.id}:${st.view}`;
    if (key === this.inkStage) return;
    this.penUp();
    this.ink.clear();
    this.inkStage = key;
  }

  /** Strokes to draw at `t` (our clock); faded ones are dropped. */
  liveInk(t = now()) {
    for (const [id, s] of this.ink) {
      // They left mid-stroke: it counts as lifted.
      if (s.up === undefined && s.by !== this.me && !this.mesh.links.get(s.by)?.open) s.up = s.pts[s.pts.length - 1][2];
      if (inkAlpha(s, s.by === this.me ? t : t - PLAYBACK_MS) <= 0) this.ink.delete(id);
    }
    return this.ink.values();
  }

  /** Pen down at (x, y), fractions of the shared picture. `pressure` only from a stylus; mouse and touch get it from their speed. */
  penDown(x: number, y: number, pressure?: number) {
    this.penUp();
    const id = `${this.me}:${rid(6)}`;
    const stroke: InkStroke = { by: this.me, c: this.inkSlot, pts: [] };
    this.ink.set(id, stroke);
    this.pen = { id, stroke, out: [], timer: setInterval(() => this.flushPen(), 50) };
    this.penMove(x, y, pressure);
  }

  penMove(x: number, y: number, pressure?: number) {
    const p = this.pen;
    if (!p) return;
    const pt: InkPoint = [Math.round(x * 1e4) / 1e4, Math.round(y * 1e4) / 1e4, Math.round(now())];
    if (pressure !== undefined) pt.push(Math.round(pressure * 100) / 100);
    p.stroke.pts.push(pt);
    p.out.push(pt);
  }

  penUp() {
    const p = this.pen;
    if (!p) return;
    clearInterval(p.timer);
    p.stroke.up = Math.round(now());
    this.pen = null;
    this.flushPen(p);
  }

  /** New points go to everyone about every 50 ms, on our own channels (never the signaling server). */
  private flushPen(p = this.pen) {
    if (!p || (!p.out.length && p.stroke.up === undefined)) return;
    const m = { t: 'ink', id: p.id, c: p.stroke.c, on: this.inkStage, p: p.out, up: p.stroke.up };
    p.out = [];
    this.mesh.broadcast(m);
    this.logInk(this.me, m, 0);
  }

  /** Someone's points, stamped on their clock: ours live, take time in the director's log. */
  private onInk(peer: PeerId, m: { id: string; c?: number; on: string; p: InkPoint[]; up?: number }) {
    if (m.on !== this.inkStage) return; // drawn on a stage we've already cut away from
    const off = this.offsetTo(peer) ?? 0;
    let s = this.ink.get(m.id);
    if (!s && !m.p.length) return;
    if (!s) this.ink.set(m.id, (s = { by: peer, c: m.c, pts: [] }));
    for (const [x, y, t, ...pr] of m.p) s.pts.push([x, y, t - off, ...pr]);
    if (m.up !== undefined) s.up = m.up - off;
    this.logInk(peer, m, off);
  }

  /** Director, during a take: log the points in take time (outside a take, ink is live only). */
  private logInk(by: PeerId, m: { id: string; c?: number; p: InkPoint[]; up?: number }, off: number) {
    const take = this.shared.take.v;
    const dm = this.dm;
    if (!take || take.stopAt || take.director !== this.me || dm?.take.id !== take.id) return;
    const at = (t: number) => Math.round(t - off - take.startAt);
    const s = (this.inkLog[m.id] ??= { by, c: m.c, pts: [] });
    for (const [x, y, t, ...pr] of m.p) s.pts.push([x, y, at(t), ...pr]);
    if (m.up !== undefined) s.up = at(m.up);
    // Saved a second after drawing starts, and right away once a stroke is
    // finished, so a reload loses at most the stroke still being drawn.
    const save = () => {
      if (this.inkSave) clearTimeout(this.inkSave);
      this.inkSave = null;
      if (this.dm === dm) fs.writeJson(dm.take.id, 'ink.json', this.inkLog).catch(() => {});
    };
    if (m.up !== undefined) save();
    else this.inkSave ??= setTimeout(save, 1000);
  }

  // ------------------------------------------------------------------ reactions

  /** Sends an emoji (a Noto codepoint) floating up everyone's stage, ours included. */
  react(cp: string) {
    const at = Math.round(now());
    const named = at - (this.lastSent.get(cp) ?? -Infinity) >= NAME_COOLDOWN_MS;
    this.lastSent.set(cp, at);
    const r: Reaction = { id: `${this.me}:${rid(6)}`, by: this.me, cp, at, seed: crypto.getRandomValues(new Uint32Array(1))[0], named };
    this.showReaction(r);
    // Peer to peer on our own channels, like everything else.
    this.mesh.broadcast({ t: 'react', id: r.id, cp, at: r.at, seed: r.seed, named });
    this.logReaction(r);
  }

  /** Someone's reaction, stamped on their clock. */
  private onReact(peer: PeerId, m: { id: string; cp: string; at: number; seed: number; named?: boolean }) {
    if (!/^[0-9a-f]{2,6}(_[0-9a-f]{2,6})*$/.test(m.cp) || this.reactions.has(m.id)) return;
    const off = this.offsetTo(peer) ?? 0;
    const r: Reaction = { id: m.id, by: peer, cp: m.cp, at: m.at - off, seed: m.seed >>> 0, named: m.named === true };
    // Live it starts on arrival at the latest, whatever the clocks say.
    const t = now();
    this.showReaction({ ...r, at: Math.max(t - 500, Math.min(t, r.at)) });
    this.logReaction(r);
  }

  private showReaction(r: Reaction) {
    this.reactions.set(r.id, r);
    this.reactWatchers.forEach((fn) => fn());
  }

  /** Reactions to draw at `t` (our clock); landed ones are dropped. */
  liveReactions(t = now()) {
    for (const [id, r] of this.reactions) if (t >= r.at + FLIGHT_MS) this.reactions.delete(id);
    return this.reactions.values();
  }

  /** Called whenever a reaction arrives (the overlay wakes up for it). */
  watchReactions(fn: () => void) {
    this.reactWatchers.add(fn);
    return () => void this.reactWatchers.delete(fn);
  }

  /** Director, during a take: log it in take time, and keep the emoji's animation for the render. */
  private logReaction(r: Reaction) {
    const take = this.shared.take.v;
    const dm = this.dm;
    if (!take || take.stopAt || take.director !== this.me || dm?.take.id !== take.id) return;
    this.reactLog.push({ ...r, at: Math.round(r.at - take.startAt) });
    this.saveLottie(take.id, r.cp);
    this.reactSave ??= setTimeout(() => {
      this.reactSave = null;
      if (this.dm === dm) fs.writeJson(dm.take.id, 'reactions.json', this.reactLog).catch(() => {});
    }, 1000);
  }

  private saveLottie(takeId: string, cp: string) {
    if (this.lottieSaves.has(cp)) return;
    const save = async () => {
      if (await fs.fileSize(takeId, `lottie-${cp}.json`)) return;
      await fs.writeText(takeId, `lottie-${cp}.json`, await fetchLottie(cp));
    };
    this.lottieSaves.set(
      cp,
      save().catch((e) => {
        console.warn('[reactions] could not keep', cp, e);
        this.lottieSaves.delete(cp); // the next one tries again; the render falls back to Google
      }),
    );
  }
}
