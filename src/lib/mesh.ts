// Full mesh between everyone in the room.
//
// VDO.Ninja's hosted signaling server is used only to find each other: the SDK's
// autoConnect in 'half' mode creates exactly one data-only connection per pair.
// On that connection we open an app channel ('x-sig'), say hello, and negotiate
// our own RTCPeerConnection (Link). From then on media, room state and file
// transfers all run on our Links, peer to peer.
//
// The mesh repairs itself. Everyone's pings list who they're connected to; a
// peer others reach but we don't for 10 s, a link that never opens, a stuck
// negotiation or a missing stream (room.ts) gets the link rebuilt. A rebuild
// is signaled over x-sig when it's still up, else relayed through a peer we
// both reach, so it doesn't need VDO.Ninja at all once we've met.
import VDONinja from '@vdoninja/sdk';
import { clock, Link, type Relay, type SigMessage } from './link';
import { SALT } from './passcheck';
import type { PeerId } from './types';
import { rid } from './util';

/** Others reach them and we don't for this long: rebuild. */
const MISSING_MS = 10_000;
/** A link not open after this long gets rebuilt; one that was open and closed, sooner. */
const OPEN_MS = 15_000;
const REOPEN_MS = 5_000;
/** Negotiation unfinished this long: roll it back; this long again: rebuild. */
const STUCK_MS = 10_000;
/** Connection 'disconnected' this long: rebuild. */
const DISCONNECTED_MS = 15_000;
/** A roster older than this no longer counts. */
const ROSTER_MS = 15_000;

/** What travels on x-sig, or relayed. */
type Wire = {
  hello?: PeerId;
  reply?: boolean;
  /** Per page load: a hello from the session we're already linked with isn't a reload. */
  session?: string;
  link?: string;
  /** Build a new link even if the current one looks fine (a repair). */
  fresh?: boolean;
  /** Please rebuild (from the polite side: only the impolite side starts rebuilds). */
  rebuild?: PeerId;
  why?: string;
  sig?: SigMessage;
};

export class Mesh {
  readonly links = new Map<PeerId, Link>();
  readonly session = rid(8);
  private sdk: VDONinja | null = null;
  private sigByPeer = new Map<PeerId, RTCDataChannel>();
  /** Their session, from their last hello. */
  private sessions = new Map<PeerId, string>();
  /** The peer a relayed message from them last came through. */
  private relayVia = new Map<PeerId, PeerId>();
  /** Who each peer said (in its last ping) it's connected to. */
  private rosters = new Map<PeerId, { peers: Set<PeerId>; at: number }>();
  /** Peers others reach and we don't, since when. */
  private missing = new Map<PeerId, number>();
  private repairs = new Map<PeerId, { n: number; at: number }>();
  private lastBuild = new Map<PeerId, number>();
  /** Peers that said goodbye: not missing, even if someone's roster still lists them. */
  private gone = new Map<PeerId, number>();
  private timer: ReturnType<typeof setInterval> | null = null;
  /** Recent signaling events, for debugging (the console, or the connection details). */
  readonly trace: string[] = [];
  status: 'connecting' | 'connected' | 'error' = 'connecting';
  error: string | null = null;

  constructor(
    readonly me: PeerId,
    private readonly room: string,
    private readonly password: string,
    private readonly onLink: (link: Link) => void,
    private readonly onChange: () => void,
  ) {}

  log(line: string) {
    this.trace.push(`${clock()} ${line}`);
    if (this.trace.length > 300) this.trace.splice(0, 100);
  }

  async start() {
    // turnServers:false: never fetch or use VDO.Ninja's TURN relays, even for
    // this small bootstrap link. Pairs that can't connect directly just don't.
    const sdk = (this.sdk = new VDONinja({ salt: SALT, password: this.password, turnServers: false } as any));
    sdk.addEventListener('dataChannelOpen', (e: any) => {
      // The side that "viewed" the other opens our app channel.
      this.log(`dataChannelOpen ${e.detail.type} ${e.detail.streamID}`);
      if (e.detail.type === 'viewer') this.openSig(e.detail.uuid);
    });
    sdk.addEventListener('channelOpen', (e: any) => {
      if (e.detail.label === 'x-sig') this.adopt(e.detail.channel, false);
    });
    sdk.addEventListener('reconnected', () => this.onChange());
    for (const ev of ['listing', 'videoaddedtoroom', 'peerConnected', 'peerDisconnected', 'connectionFailed', 'reconnecting', 'reconnected', 'reconnectFailed', 'alert', 'error'])
      sdk.addEventListener(ev, (e: any) => this.log(`${ev} ${JSON.stringify(e.detail ?? {}).slice(0, 200)}`));
    this.timer = setInterval(() => this.tick(), 2000);
    try {
      // A per-session suffix keeps a quick reload from colliding with our previous
      // (not yet expired) stream ID on the server. Identity travels in our hello.
      await sdk.autoConnect({ room: `samurai_${this.room}`, password: this.password, streamID: `${this.me}${rid(4)}`, mode: 'half' } as any);
      this.status = 'connected';
    } catch (e) {
      this.status = 'error';
      this.error = String((e as Error)?.message ?? e);
    }
    this.onChange();
  }

  private async openSig(uuid: string) {
    try {
      this.adopt(await this.sdk!.openChannel(uuid, 'sig'), true);
    } catch (e) {
      this.log(`could not open x-sig: ${e}`);
      console.warn('[mesh] could not open x-sig', e);
    }
  }

  /**
   * Only the side that opened the channel speaks first: its own handler is
   * attached by the time it sends, so the reply can't arrive unheard.
   */
  private adopt(ch: RTCDataChannel, opener: boolean) {
    let peer: PeerId | null = null;
    ch.onmessage = (e) => {
      const m: Wire = JSON.parse(e.data);
      if (m.hello) {
        peer = m.hello;
        this.sigByPeer.set(peer, ch);
      }
      if (peer) this.receive(peer, m);
    };
    ch.onclose = () => {
      if (peer && this.sigByPeer.get(peer) === ch) {
        this.sigByPeer.delete(peer);
        this.log(`x-sig to ${peer} closed`);
      }
    };
    if (opener) ch.send(JSON.stringify({ hello: this.me, session: this.session, link: rid(6) } satisfies Wire));
  }

  /** A message on x-sig, or relayed (`via`: the peer that passed it along). */
  private receive(peer: PeerId, m: Wire, via?: PeerId) {
    if (via) this.relayVia.set(peer, via);
    if (m.hello) {
      const cur = this.links.get(peer);
      // Tabs from before link ids (a deploy mid-call) don't send one.
      const id = m.link ?? (m.reply ? cur?.id : undefined) ?? rid(6);
      const sameSession = !!m.session && this.sessions.get(peer) === m.session;
      if (m.session) this.sessions.set(peer, m.session);
      this.gone.delete(peer);
      if (!m.reply) {
        // The same session saying hello again is VDO.Ninja reconnecting, not a
        // reload: keep a link that works.
        if (!m.fresh && sameSession && cur?.open) {
          this.log(`hello from ${peer} again (same session): keeping link ${cur.id}`);
          this.sendTo(peer, { hello: this.me, reply: true, session: this.session, link: cur.id });
          return;
        }
        this.log(`hello from ${peer}${m.fresh ? ' (rebuild)' : ''}${via ? ` via ${via}` : ''}: link ${id}`);
        this.sendTo(peer, { hello: this.me, reply: true, session: this.session, link: id });
        this.build(peer, id);
      } else if (!cur || cur.id !== id || cur.pc.connectionState === 'closed' || cur.pc.connectionState === 'failed') {
        // A reply to our hello: build unless we already did (rebuilds build eagerly).
        this.build(peer, id);
      }
    } else if (m.rebuild) {
      // Only the impolite side starts rebuilds, so two can't cross.
      this.log(`${peer} asks for a rebuild: ${m.why ?? ''}`);
      if (this.me > peer && performance.now() - (this.lastBuild.get(peer) ?? -Infinity) > 2000) this.rebuildNow(peer, `asked: ${m.why ?? ''}`);
    } else if (m.sig) {
      // Accept late signals here even after our side moved to ctl: the two
      // sides switch at slightly different moments. Not an older link's, though.
      const l = this.links.get(peer);
      if (l && (!m.link || m.link === l.id)) l.receiveSignal(m.sig);
    }
  }

  /** Over x-sig if it's up, else relayed through a peer we both reach. False: no way to reach them. */
  private sendTo(peer: PeerId, m: Wire) {
    const ch = this.sigByPeer.get(peer);
    if (ch?.readyState === 'open') {
      ch.send(JSON.stringify(m));
      return true;
    }
    const via = this.relayFor(peer);
    if (via) {
      via.send({ relay: { to: peer, m } satisfies Relay });
      return true;
    }
    return false;
  }

  /** An open link to someone who reaches `peer`: the last one that relayed for them, else anyone whose roster has them. */
  private relayFor(peer: PeerId) {
    const ok = (l: Link | undefined) => l?.open && l.peer !== peer && (this.rosters.get(l.peer)?.peers.has(peer) ?? false);
    const last = this.links.get(this.relayVia.get(peer) ?? '');
    if (ok(last)) return last!;
    for (const l of this.links.values()) if (ok(l)) return l;
    return last?.open ? last : null;
  }

  private onRelay(from: Link, r: Relay) {
    if (r.to) {
      // Passing it along: one hop, to someone we're linked with.
      if (r.to === this.me) return;
      const out = this.links.get(r.to);
      if (out?.open) out.send({ relay: { from: from.peer, m: r.m } satisfies Relay });
    } else if (r.from && r.from !== this.me) {
      this.receive(r.from, r.m as Wire, from.peer);
    }
  }

  /** A hello means a fresh link: their reload, or a rebuild. */
  private build(peer: PeerId, id: string) {
    this.links.get(peer)?.close();
    this.lastBuild.set(peer, performance.now());
    const link = new Link(peer, id, this.me < peer, (sig) => void this.sendTo(peer, { sig, link: id }));
    link.onRelay = (r) => this.onRelay(link, r);
    this.links.set(peer, link);
    this.log(`build link ${id} to ${peer}`);
    link.pc.addEventListener('connectionstatechange', () => {
      if (this.links.get(peer) !== link) return;
      const st = link.pc.connectionState;
      this.log(`link ${id} to ${peer}: ${st}`);
      if (st === 'failed' || st === 'closed') {
        this.links.delete(peer);
        this.onChange();
        if (st === 'failed') this.repair(peer, 'connection failed');
      }
    });
    this.onLink(link);
    this.onChange();
  }

  /**
   * Get a working link to `peer` back, backing off (3 s doubling to 30 s,
   * forgotten after two quiet minutes) so a hopeless pair doesn't thrash.
   */
  repair(peer: PeerId, why: string, force = false) {
    const t = performance.now();
    let r = this.repairs.get(peer) ?? { n: 0, at: -Infinity };
    if (t - r.at > 120_000) r = { n: 0, at: -Infinity };
    if (!force && t - r.at < Math.min(30_000, 3000 * 2 ** r.n)) return;
    this.repairs.set(peer, { n: r.n + 1, at: t });
    if (this.me > peer) return this.rebuildNow(peer, why);
    this.log(`repair ${peer} (${why}): asking them to rebuild`);
    if (!this.sendTo(peer, { rebuild: this.me, why })) this.unreachable(peer);
  }

  private rebuildNow(peer: PeerId, why: string) {
    const id = rid(6);
    this.log(`repair ${peer} (${why}): rebuilding as link ${id}`);
    if (!this.sendTo(peer, { hello: this.me, session: this.session, link: id, fresh: true })) return this.unreachable(peer);
    this.build(peer, id);
  }

  /** No x-sig and nobody to relay through: drop a dead link; VDO.Ninja or a roster may bring them back. */
  private unreachable(peer: PeerId) {
    this.log(`repair ${peer}: no way to reach them right now`);
    const l = this.links.get(peer);
    if (l && !l.open) {
      l.close();
      this.links.delete(peer);
      this.onChange();
    }
  }

  /** Who `from` says it's connected to (from its ping). */
  heard(from: PeerId, peers: PeerId[]) {
    this.rosters.set(from, { peers: new Set(peers), at: performance.now() });
  }

  private tick() {
    const t = performance.now();
    for (const [peer, l] of this.links) {
      // pc.close() and some failures close the channel without a connection state event.
      const down = l.open ? 0 : t - (l.downSince ?? t);
      if (down > (l.wasOpen ? REOPEN_MS : OPEN_MS)) this.repair(peer, `${l.wasOpen ? 'lost' : 'not connected'} for ${Math.round(down / 1000)} s (${l.pc.connectionState}, ${l.pc.signalingState})`);
      else if (l.open && l.unstableSince !== null && t - l.unstableSince > STUCK_MS) {
        if (l.unstuckAt === null) l.unstick();
        else if (t - l.unstuckAt > STUCK_MS) this.repair(peer, `negotiation stuck in ${l.pc.signalingState}`);
      } else if (l.disconnectedSince !== null && t - l.disconnectedSince > DISCONNECTED_MS) this.repair(peer, 'disconnected');
    }
    // Missing: someone others reach and we don't.
    const reported = new Set<PeerId>();
    for (const [from, r] of this.rosters) {
      if (t - r.at > ROSTER_MS || !this.links.get(from)?.open) this.rosters.delete(from);
      else for (const p of r.peers) if (p !== this.me && !this.gone.has(p)) reported.add(p);
    }
    for (const [p, at] of this.gone) if (t - at > ROSTER_MS) this.gone.delete(p);
    for (const p of this.missing.keys()) if (!reported.has(p) || this.links.get(p)?.open) this.missing.delete(p);
    for (const p of reported) {
      const l = this.links.get(p);
      if (l?.open) continue;
      const since = this.missing.get(p) ?? t;
      if (!this.missing.has(p)) {
        this.missing.set(p, t);
        this.log(`missing ${p}: others reach them, we don't`);
        this.onChange();
      }
      // A link still coming up is the check above's business.
      if (t - since >= MISSING_MS && !(l && !l.wasOpen && t - l.born < OPEN_MS)) this.repair(p, 'others reach them, we don\'t');
    }
  }

  /** Peers others reach and we don't, and for how long (ms). */
  missingPeers() {
    const t = performance.now();
    return [...this.missing].map(([peer, since]) => ({ peer, ms: t - since }));
  }

  /** Repair history for one peer, for the connection details. */
  repairsOf(peer: PeerId) {
    return this.repairs.get(peer)?.n ?? 0;
  }

  hasSig(peer: PeerId) {
    return this.sigByPeer.get(peer)?.readyState === 'open';
  }

  /** Only drops `link` if it's still the current one: a late goodbye mustn't take down its replacement. */
  drop(peer: PeerId, link?: Link) {
    const cur = this.links.get(peer);
    if (link && cur !== link) return;
    this.log(`${peer} said goodbye`);
    cur?.close();
    this.links.delete(peer);
    this.gone.set(peer, performance.now());
    this.missing.delete(peer);
    this.onChange();
  }

  /** Peers whose control channel is open. */
  openLinks() {
    return [...this.links.values()].filter((l) => l.open);
  }

  broadcast(m: unknown, except?: PeerId) {
    for (const l of this.links.values()) if (l.peer !== except) l.send(m);
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    for (const l of this.links.values()) l.send({ t: 'bye' });
    for (const l of this.links.values()) l.close();
    this.links.clear();
    await this.sdk?.disconnect().catch(() => {});
  }
}
