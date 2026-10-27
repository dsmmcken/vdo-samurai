// One RTCPeerConnection that we own, to one remote peer.
//
// It is first signaled over a VDO.Ninja data channel (see mesh.ts). As soon as
// its own pre-negotiated 'ctl' channel opens, all further signaling (track
// changes, ICE restarts) moves onto it, so VDO.Ninja is out of the loop.
//
// ICE uses public STUN only; we deliberately never use VDO.Ninja's TURN relays
// for our media or file transfers.
import type { PeerId } from './types';

const ICE: RTCIceServer[] = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }];

export type TrackRole = 'mic' | 'cam' | 'screen';

export type SigMessage = { description?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit | null };

export interface LinkEvents {
  message: (m: any) => void;
  stream: (stream: MediaStream) => void;
  fileChannel: (ch: RTCDataChannel) => void;
  state: () => void;
}

export class Link {
  readonly pc: RTCPeerConnection;
  readonly ctl: RTCDataChannel;
  readonly remoteStreams = new Map<string, MediaStream>();
  /** 'bootstrap' until our ctl channel opens. */
  transport: 'bootstrap' | 'ctl' = 'bootstrap';
  route: 'direct' | 'relay' | null = null;
  /** Signaling history, for debugging from the console. */
  readonly trace: string[] = [];
  private makingOffer = false;
  private answeredFirst = false;
  private ignoreOffer = false;
  /** Outgoing senders by role, so a track can be swapped (or paused with null) without renegotiating. */
  private senders = new Map<TrackRole, { sender: RTCRtpSender; track: MediaStreamTrack | null }>();
  private handlers: Partial<LinkEvents> = {};

  constructor(
    readonly peer: PeerId,
    private readonly polite: boolean,
    private sendSignal: (m: SigMessage) => void,
  ) {
    const pc = (this.pc = new RTCPeerConnection({ iceServers: ICE }));
    pc.onnegotiationneeded = async () => {
      // The polite side waits for the first offer instead of racing it: in Chrome,
      // offer glare at setup can leave the polite side never emitting ICE
      // candidates. Chrome re-fires this event once that negotiation settles.
      if (this.polite && !this.answeredFirst) return void this.log('negotiationneeded (deferred)');
      this.log('negotiationneeded');
      try {
        this.makingOffer = true;
        await pc.setLocalDescription();
        this.signal({ description: pc.localDescription!.toJSON() });
      } catch (e) {
        this.log(`offer error ${e}`);
        console.warn('[link] negotiation failed', e);
      } finally {
        this.makingOffer = false;
      }
    };
    pc.onicecandidate = ({ candidate }) => candidate && this.signal({ candidate: candidate.toJSON() });
    pc.ontrack = ({ track, streams }) => {
      const stream = streams[0] ?? new MediaStream([track]);
      this.remoteStreams.set(stream.id, stream);
      stream.onremovetrack = () => this.emit('state');
      this.handlers.stream?.(stream);
    };
    pc.ondatachannel = ({ channel }) => {
      if (channel.label.startsWith('f:')) this.handlers.fileChannel?.(channel);
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') this.updateRoute();
      this.emit('state');
    };

    // Watchdog: after offer glare Chrome occasionally never emits fresh ICE
    // candidates, leaving both sides "stable" but unconnected. An ICE restart from
    // the impolite side forces a new offer with new candidates.
    let restarts = 0;
    const watchdog = setInterval(() => {
      const st = pc.connectionState;
      if (st === 'connected' || st === 'closed' || restarts >= 4) return clearInterval(watchdog);
      if (!this.polite && pc.signalingState === 'stable') {
        restarts++;
        this.log('watchdog ice restart');
        pc.restartIce();
      }
    }, 5000);

    this.ctl = pc.createDataChannel('ctl', { negotiated: true, id: 0 });
    this.ctl.onopen = () => {
      this.transport = 'ctl';
      this.sendSignal = (m) => this.send({ sig: m });
      this.emit('state');
    };
    this.ctl.onclose = () => this.emit('state');
    this.ctl.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.sig) this.receiveSignal(m.sig);
      else this.handlers.message?.(m);
    };
  }

  private log(line: string) {
    this.trace.push(line);
    if (this.trace.length > 200) this.trace.splice(0, 50);
  }

  on<K extends keyof LinkEvents>(event: K, fn: LinkEvents[K]) {
    this.handlers[event] = fn;
  }

  private emit(event: 'state') {
    this.handlers[event]?.();
  }

  get open() {
    return this.ctl.readyState === 'open';
  }

  send(m: unknown) {
    if (this.ctl.readyState === 'open') this.ctl.send(JSON.stringify(m));
  }

  private signal(m: SigMessage) {
    this.log(`tx ${m.description?.type ?? 'cand'} via ${this.transport}`);
    try {
      this.sendSignal(m);
    } catch (e) {
      console.warn('[link] signal send failed', e);
    }
  }

  async receiveSignal({ description, candidate }: SigMessage) {
    const pc = this.pc;
    this.log(`rx ${description?.type ?? 'cand'} in ${pc.signalingState}`);
    try {
      if (description) {
        const collision = description.type === 'offer' && (this.makingOffer || pc.signalingState !== 'stable');
        this.ignoreOffer = !this.polite && collision;
        if (this.ignoreOffer) return void this.log('ignored offer');
        await pc.setRemoteDescription(description);
        if (description.type === 'offer') {
          await pc.setLocalDescription();
          this.signal({ description: pc.localDescription!.toJSON() });
          this.answeredFirst = true;
        }
      } else if (candidate) {
        try {
          await pc.addIceCandidate(candidate);
        } catch (e) {
          if (!this.ignoreOffer) throw e;
        }
      }
    } catch (e) {
      this.log(`error ${e}`);
      console.warn('[link] signal handling failed', String(e));
    }
  }

  /**
   * Make the outgoing tracks match `tracks`, one per role. A role whose track
   * changed gets replaceTrack (no renegotiation; `null` sends nothing, e.g.
   * camera off). New roles start with `enc` so they never briefly send at full
   * resolution; roles no longer listed are removed.
   */
  setTracks(tracks: Array<{ role: TrackRole; track: MediaStreamTrack | null; stream: MediaStream; enc: RTCRtpEncodingParameters }>) {
    if (this.pc.signalingState === 'closed') return;
    const wanted = new Set(tracks.map((t) => t.role));
    for (const [role, s] of this.senders) {
      if (!wanted.has(role)) {
        this.pc.removeTrack(s.sender);
        this.senders.delete(role);
      }
    }
    for (const { role, track, stream, enc } of tracks) {
      const cur = this.senders.get(role);
      if (cur) {
        if (cur.track !== track) {
          cur.track = track;
          cur.sender.replaceTrack(track).catch((e) => console.warn('[link] replaceTrack failed', e));
        }
        continue;
      }
      if (!track) continue; // nothing to send yet
      const tr = this.pc.addTransceiver(track, { direction: 'sendonly', streams: [stream], sendEncodings: [enc] });
      this.senders.set(role, { sender: tr.sender, track });
    }
  }

  /** Live encoder settings for one outgoing role; no renegotiation. */
  async setEncoding(role: TrackRole, enc: RTCRtpEncodingParameters) {
    const sender = this.senders.get(role)?.sender;
    if (!sender) return;
    const params = sender.getParameters();
    if (!params.encodings?.length) params.encodings = [{}];
    const cur = params.encodings[0];
    const same = (Object.keys(enc) as (keyof RTCRtpEncodingParameters)[]).every((k) => cur[k] === enc[k]);
    if (same) return;
    Object.assign(cur, enc);
    try {
      await sender.setParameters(params);
    } catch (e) {
      // Fails if called mid-negotiation; the caller re-applies on the next change.
      console.debug('[link] setParameters deferred', e);
    }
  }

  private async updateRoute() {
    const stats = await this.pc.getStats();
    const byId = new Map<string, any>();
    stats.forEach((s) => byId.set(s.id, s));
    for (const s of byId.values()) {
      if (s.type === 'candidate-pair' && s.nominated && s.state === 'succeeded') {
        const types = [byId.get(s.localCandidateId)?.candidateType, byId.get(s.remoteCandidateId)?.candidateType];
        this.route = types.includes('relay') ? 'relay' : 'direct';
      }
    }
    this.emit('state');
  }

  close() {
    this.pc.close();
  }
}
