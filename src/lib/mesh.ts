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
/**
 * An open link that's carried nothing for this long (pings go both ways every
 * 5 s) is stuck: after a network drop, SCTP can sit in retransmit backoff for
 * tens of seconds while ICE says connected, and the screen share and control
 * messages ride on it.
 */
const SILENT_MS = 12_000;
/** After this many repairs in a row without a lasting link, try only every SLOW_REPAIR_MS. */
const GIVE_UP_AFTER = 6;
const SLOW_REPAIR_MS = 120_000;
/** A roster older than this no longer counts. */
const ROSTER_MS = 15_000;

/** What travels on x-sig, or relayed. */
type Wire = {
  hello?: PeerId;
  reply?: boolean;
  /** On a reply: they kept the link they already had instead of building ours. */
  kept?: boolean;
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
  /** Link ids of hellos we sent, and when: a reply to one we've since moved past is stale. */
  private myHellos = new Map<string, number>();
  /** Signals that found no path, per peer: logged once per few seconds, with a count. */
  private noPath = new Map<PeerId, { at: number; n: number }>();
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
    if (this.trace.length > 600) this.trace.splice(0, 200);
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
    if (opener) {
      const link = rid(6);
      this.sentHello(link);
      ch.send(JSON.stringify({ hello: this.me, session: this.session, link } satisfies Wire));
    }
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
        // reload: keep a link that works or is still coming up. (VDO.Ninja's own
        // connection often comes back just as ours connects, before its control
        // channel opens; rebuilding then throws away a link that just got through.)
        if (!m.fresh && sameSession && cur && this.live(cur)) {
          this.log(`hello from ${peer} again (same session): keeping link ${cur.id} (${cur.open ? 'open' : cur.pc.connectionState})`);
          this.sendTo(peer, { hello: this.me, reply: true, kept: true, session: this.session, link: cur.id });
          return;
        }
        this.log(`hello from ${peer}${m.fresh ? ' (rebuild)' : ''}${via ? ` via ${via}` : ''}: link ${id}`);
        this.sendTo(peer, { hello: this.me, reply: true, session: this.session, link: id });
        this.build(peer, id);
      } else if (m.kept && cur?.id !== id) {
        // They kept a link we no longer have (they stalled while we gave up on
        // it). Building one under its id would talk to their dead one: start fresh.
        this.log(`${peer} kept link ${id}, ours is ${cur?.id ?? 'gone'}: rebuilding`);
        if (this.me > peer) this.rebuildNow(peer, `they kept link ${id}`);
        else this.sendTo(peer, { rebuild: this.me, why: `you kept link ${id}, ours is ${cur?.id ?? 'gone'}`, link: id });
      } else if (cur && cur.id !== id && cur.born > (this.myHellos.get(id) ?? Infinity)) {
        // A reply to a hello we've since replaced with a newer one (crossed
        // rebuilds): building its link now would tear down the newer one.
        this.log(`stale reply from ${peer} for link ${id}: we've since built ${cur.id}; ignored`);
      } else if (!cur || cur.id !== id || cur.pc.connectionState === 'closed' || cur.pc.connectionState === 'failed') {
        // A reply to our hello: build unless we already did (rebuilds build eagerly).
        this.build(peer, id);
      }
    } else if (m.rebuild) {
      // Only the impolite side starts rebuilds, so two can't cross.
      const cur = this.links.get(peer);
      const t = performance.now();
      this.log(`${peer} asks for a rebuild${m.link ? ` of link ${m.link}` : ''}: ${m.why ?? ''}`);
      if (this.me < peer) this.log(`  ignored: only the side with the larger id rebuilds`);
      else if (m.link && cur && m.link !== cur.id && t - cur.born < OPEN_MS) this.log(`  ignored: link ${m.link} is already replaced by ${cur.id} (${Math.round((t - cur.born) / 1000)} s old, still coming up)`);
      else if (t - (this.lastBuild.get(peer) ?? -Infinity) <= 2000) this.log(`  ignored: we rebuilt ${Math.round(t - this.lastBuild.get(peer)!)} ms ago`);
      // Same backoff as our own repairs: asking mustn't make a hopeless pair thrash.
      else if (!this.repair(peer, `asked: ${m.why ?? ''}`)) this.log(`  not yet: backing off (${this.backoffText(peer)})`);
    } else if (m.sig) {
      // Accept late signals here even after our side moved to ctl: the two
      // sides switch at slightly different moments. Not an older link's, though.
      const l = this.links.get(peer);
      if (l && (!m.link || m.link === l.id)) l.receiveSignal(m.sig);
    }
  }

  /** Over x-sig if it's up, else relayed through a peer we both reach. False: no way to reach them. */
  private sendTo(peer: PeerId, m: Wire) {
    // Signals are too many to log; everything else says which way it went.
    const what = m.sig ? null : m.hello ? `${m.reply ? (m.kept ? 'hello reply (kept)' : 'hello reply') : m.fresh ? 'hello (rebuild)' : 'hello'} link ${m.link}` : m.rebuild ? 'rebuild request' : 'message';
    const ch = this.sigByPeer.get(peer);
    if (ch?.readyState === 'open') {
      try {
        ch.send(JSON.stringify(m));
      } catch (e) {
        this.log(`→ ${peer} ${what ?? 'signal'} over x-sig failed: ${e}`);
        return false;
      }
      if (what) this.log(`→ ${peer} ${what} over x-sig`);
      return true;
    }
    const via = this.relayFor(peer);
    if (via) {
      via.send({ relay: { to: peer, m } satisfies Relay });
      if (what) this.log(`→ ${peer} ${what} relayed via ${via.peer}`);
      return true;
    }
    const np = this.noPath.get(peer);
    const t = performance.now();
    if (!what && np && t - np.at < 5000) {
      np.n++;
      return false;
    }
    this.noPath.set(peer, { at: t, n: 0 });
    this.log(`→ ${peer} ${what ?? 'signal'}: no x-sig and no one to relay through (rosters: ${[...this.rosters].map(([p, r]) => `${p}:[${[...r.peers].join(',')}]`).join(' ') || 'none'})${np?.n ? `; ${np.n} more signals dropped since the last such line` : ''}`);
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
      const m = r.m as Wire;
      if (out?.open) {
        out.send({ relay: { from: from.peer, m: r.m } satisfies Relay });
        if (!m?.sig) this.log(`relayed ${m?.hello ? 'hello' : m?.rebuild ? 'rebuild request' : 'message'} from ${from.peer} to ${r.to}`);
      } else this.log(`relay from ${from.peer} to ${r.to} DROPPED: no open link to ${r.to}${out ? ` (${out.pc.connectionState})` : ''}`);
    } else if (r.from && r.from !== this.me) {
      this.receive(r.from, r.m as Wire, from.peer);
    }
  }

  /** A hello means a fresh link: their reload, or a rebuild. */
  private build(peer: PeerId, id: string) {
    const old = this.links.get(peer);
    if (old && !old.wasOpen && old.pc.connectionState !== 'closed' && performance.now() - old.born > 3000) {
      // Why it never connected (stats are asked for before it's closed).
      const oid = old.id;
      void old.iceSummary().then((s) => this.log(`link ${oid} to ${peer} never connected: ${s}`));
    }
    old?.close();
    this.lastBuild.set(peer, performance.now());
    const link = new Link(peer, id, this.me < peer, (sig) => void this.sendTo(peer, { sig, link: id }));
    link.onRelay = (r) => this.onRelay(link, r);
    this.links.set(peer, link);
    this.log(`build link ${id} to ${peer}`);
    link.pc.addEventListener('connectionstatechange', () => {
      if (this.links.get(peer) !== link) return;
      const st = link.pc.connectionState;
      this.log(`link ${id} to ${peer}: ${st}`);
      if (st === 'connected' || st === 'failed') void link.iceSummary().then((s) => this.log(`link ${id} to ${peer} ${st}: ${s}`));
      if (st === 'failed' || st === 'closed') {
        this.links.delete(peer);
        this.onChange();
        if (st === 'failed') this.repair(peer, 'connection failed');
      }
    });
    this.onLink(link);
    this.onChange();
  }

  /** How long after `n` repairs in a row the next may happen. */
  private backoff(n: number) {
    return Math.min(n >= GIVE_UP_AFTER ? SLOW_REPAIR_MS : 30_000, 3000 * 2 ** n);
  }

  private backoffText(peer: PeerId) {
    const r = this.repairs.get(peer);
    if (!r) return 'no repairs yet';
    return `${r.n} in a row, next in ${Math.max(0, Math.round((r.at + this.backoff(r.n) - performance.now()) / 1000))} s`;
  }

  /**
   * Get a working link to `peer` back, backing off (3 s doubling to 30 s; a pair
   * that has failed GIVE_UP_AFTER times in a row, every 2 min) so a hopeless
   * pair doesn't thrash. A link that stays up a minute clears the count.
   */
  repair(peer: PeerId, why: string, force = false): boolean {
    const t = performance.now();
    let r = this.repairs.get(peer) ?? { n: 0, at: -Infinity };
    if (t - r.at > 300_000) r = { n: 0, at: -Infinity };
    if (!force && t - r.at < this.backoff(r.n)) return false;
    if (r.n + 1 === GIVE_UP_AFTER) this.log(`repair ${peer}: ${GIVE_UP_AFTER} in a row without a lasting link; trying only every ${SLOW_REPAIR_MS / 60_000} min from now (Reconnect still works)`);
    this.repairs.set(peer, { n: r.n + 1, at: t });
    if (this.me > peer) {
      this.rebuildNow(peer, why);
      return true;
    }
    this.log(`repair ${peer} (${why}): asking them to rebuild`);
    // Says which link it's about, so a request that crosses their rebuild doesn't undo it.
    if (!this.sendTo(peer, { rebuild: this.me, why, link: this.links.get(peer)?.id })) this.unreachable(peer);
    return true;
  }

  /** Open, connected, or still coming up within its time to connect: worth keeping. */
  private live(l: Link) {
    if (l.open || l.pc.connectionState === 'connected') return true;
    const st = l.pc.connectionState;
    return !l.wasOpen && (st === 'new' || st === 'connecting') && performance.now() - l.born < OPEN_MS;
  }

  private sentHello(id: string) {
    const t = performance.now();
    this.myHellos.set(id, t);
    for (const [k, at] of this.myHellos) if (t - at > 120_000) this.myHellos.delete(k);
  }

  private rebuildNow(peer: PeerId, why: string) {
    const id = rid(6);
    this.sentHello(id);
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
      if (l.open && l.openedAt !== null && t - l.openedAt > 60_000 && t - l.lastHeard < SILENT_MS && this.repairs.has(peer)) {
        this.log(`repair ${peer}: link ${l.id} up for a minute, repair count cleared (was ${this.repairs.get(peer)!.n})`);
        this.repairs.delete(peer);
      }
      // pc.close() and some failures close the channel without a connection state event.
      const down = l.open ? 0 : t - (l.downSince ?? t);
      if (down > (l.wasOpen ? REOPEN_MS : OPEN_MS)) this.repair(peer, `${l.wasOpen ? 'lost' : 'not connected'} for ${Math.round(down / 1000)} s (${l.pc.connectionState}, ${l.pc.signalingState})`);
      else if (l.open && l.unstableSince !== null && t - l.unstableSince > STUCK_MS) {
        if (l.unstuckAt === null) {
          this.log(`${peer}: negotiation stuck in ${l.pc.signalingState} for ${Math.round((t - l.unstableSince) / 1000)} s: rolling back`);
          l.unstick();
        }
        else if (t - l.unstuckAt > STUCK_MS) this.repair(peer, `negotiation stuck in ${l.pc.signalingState}`);
      } else if (l.disconnectedSince !== null && t - l.disconnectedSince > DISCONNECTED_MS) this.repair(peer, 'disconnected');
      else if (l.open && t - l.lastHeard > SILENT_MS) this.repair(peer, `nothing heard for ${Math.round((t - l.lastHeard) / 1000)} s (${l.pc.connectionState})`);
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

  /** Each peer's last roster, for the connection details. */
  rosterLines(name: (id: PeerId) => string): string[] {
    const t = performance.now();
    const out = [...this.rosters].map(([from, r]) => `${name(from)}: ${[...r.peers].map((p) => (p === this.me ? 'us' : name(p))).join(', ') || 'nobody'} (${((t - r.at) / 1000).toFixed(0)} s ago)`);
    return out.length ? out : ['none yet'];
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
