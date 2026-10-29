// Full mesh between everyone in the room.
//
// VDO.Ninja's hosted signaling server is used only to find each other: the SDK's
// autoConnect in 'half' mode creates exactly one data-only connection per pair.
// On that connection we open an app channel ('x-sig'), say hello, and negotiate
// our own RTCPeerConnection (Link). From then on media, room state and file
// transfers all run on our Links, peer to peer.
import VDONinja from '@vdoninja/sdk';
import { Link } from './link';
import { SALT } from './passcheck';
import type { PeerId } from './types';
import { rid } from './util';

const MAX_REBUILDS = 3;

export class Mesh {
  readonly links = new Map<PeerId, Link>();
  private sdk: VDONinja | null = null;
  private sigByPeer = new Map<PeerId, RTCDataChannel>();
  private rebuilds = new Map<PeerId, number>();
  /** Recent signaling events, for debugging from the console. */
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

  private log(line: string) {
    this.trace.push(line);
    if (this.trace.length > 200) this.trace.splice(0, 50);
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
    for (const ev of ['listing', 'videoaddedtoroom', 'peerConnected', 'peerDisconnected', 'connectionFailed', 'alert', 'error'])
      sdk.addEventListener(ev, (e: any) => this.log(`${ev} ${JSON.stringify(e.detail ?? {}).slice(0, 200)}`));
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
      const m = JSON.parse(e.data);
      if (m.hello) {
        peer = m.hello as PeerId;
        this.sigByPeer.set(peer, ch);
        if (!m.reply) {
          ch.send(JSON.stringify({ hello: this.me, reply: true }));
          this.build(peer, ch);
        } else {
          // A reply to our hello: build unless we already did (rebuild requests build eagerly).
          const cur = this.links.get(peer);
          if (!cur || cur.pc.connectionState === 'closed' || cur.pc.connectionState === 'failed') this.build(peer, ch);
        }
      } else if (m.sig && peer) {
        // Accept late signals here even after our side moved to ctl: the two
        // sides switch at slightly different moments.
        this.links.get(peer)?.receiveSignal(m.sig);
      }
    };
    ch.onclose = () => {
      if (peer && this.sigByPeer.get(peer) === ch) this.sigByPeer.delete(peer);
    };
    if (opener) ch.send(JSON.stringify({ hello: this.me }));
  }

  /** A hello means a fresh SDK session on their side (first join or a reload): start a new Link. */
  private build(peer: PeerId, ch: RTCDataChannel) {
    this.links.get(peer)?.close();
    const link = new Link(peer, this.me < peer, (sig) => ch.readyState === 'open' && ch.send(JSON.stringify({ sig })));
    this.links.set(peer, link);
    link.pc.addEventListener('connectionstatechange', () => {
      if (this.links.get(peer) !== link) return;
      const st = link.pc.connectionState;
      if (st === 'connected') this.rebuilds.delete(peer);
      if (st === 'failed' || st === 'closed') {
        this.links.delete(peer);
        this.onChange();
        // If VDO.Ninja's channel to them is still up, the impolite side asks for a
        // rebuild a few times (the other side rebuilds when the hello arrives).
        const n = this.rebuilds.get(peer) ?? 0;
        const sig = this.sigByPeer.get(peer);
        if (st === 'failed' && this.me > peer && sig?.readyState === 'open' && n < MAX_REBUILDS) {
          this.rebuilds.set(peer, n + 1);
          sig.send(JSON.stringify({ hello: this.me }));
          this.build(peer, sig);
        }
      }
    });
    this.onLink(link);
    this.onChange();
  }

  drop(peer: PeerId) {
    this.links.get(peer)?.close();
    this.links.delete(peer);
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
    for (const l of this.links.values()) l.send({ t: 'bye' });
    for (const l of this.links.values()) l.close();
    this.links.clear();
    await this.sdk?.disconnect().catch(() => {});
  }
}
