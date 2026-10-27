// Browser-side probe. Driven from Node via Playwright (see run-*.mjs).
const lab = (window.lab = { sdks: {}, links: {}, name: null, events: [] });
const log = (...a) => {
  lab.events.push(a.map(String).join(' '));
  console.log('[lab]', ...a);
};
const STUN = [{ urls: 'stun:stun.l.google.com:19302' }];

lab.cam = async ({ width = 1280, height = 720, fps = 30 } = {}) => {
  lab.stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { width: { ideal: width }, height: { ideal: height }, frameRate: { ideal: fps }, resizeMode: 'crop-and-scale' },
  });
  return lab.stream.getVideoTracks()[0].getSettings();
};

function attach(stream) {
  const v = document.createElement('video');
  v.muted = true;
  v.autoplay = true;
  v.playsInline = true;
  v.srcObject = stream;
  document.getElementById('videos').append(v);
}

// Every RTCPeerConnection the page owns: SDK-managed ones plus our own.
function allPcs() {
  const pcs = [];
  for (const sdk of Object.values(lab.sdks))
    for (const c of sdk.connections.values())
      for (const dir of ['publisher', 'viewer']) if (c[dir]?.pc) pcs.push({ owner: `sdk:${dir}`, pc: c[dir].pc });
  for (const [peer, link] of Object.entries(lab.links)) pcs.push({ owner: `own:${peer}`, pc: link.pc });
  return pcs;
}

async function videoStats(pc) {
  const out = { tx: null, rx: null, pair: null };
  const report = await pc.getStats();
  const byId = new Map([...report.values()].map((s) => [s.id, s]));
  for (const s of report.values()) {
    if (s.type === 'outbound-rtp' && s.kind === 'video') {
      out.tx = {
        bytes: s.bytesSent,
        frames: s.framesEncoded,
        encodeTime: s.totalEncodeTime,
        width: s.frameWidth,
        height: s.frameHeight,
        fps: s.framesPerSecond,
        limit: s.qualityLimitationReason,
        encoder: s.encoderImplementation,
        codec: byId.get(s.codecId)?.mimeType,
      };
    }
    if (s.type === 'inbound-rtp' && s.kind === 'video') {
      out.rx = {
        bytes: s.bytesReceived,
        frames: s.framesDecoded,
        decodeTime: s.totalDecodeTime,
        width: s.frameWidth,
        height: s.frameHeight,
        fps: s.framesPerSecond,
        decoder: s.decoderImplementation,
      };
    }
    if (s.type === 'candidate-pair' && s.nominated && s.state === 'succeeded') {
      out.pair = `${byId.get(s.localCandidateId)?.candidateType}->${byId.get(s.remoteCandidateId)?.candidateType}`;
    }
  }
  return out;
}

lab.sample = async () => {
  const rows = [];
  for (const { owner, pc } of allPcs()) rows.push({ owner, state: pc.connectionState, ...(await videoStats(pc)) });
  return { t: performance.now(), rows };
};

// ---------------------------------------------------------------- Experiment 1
// One publisher, one viewer, via the VDO.Ninja SDK only.

lab.publish = async ({ room, password, streamID, media }) => {
  const sdk = (lab.sdks.main = new VDONinjaSDK({ salt: 'vdo.ninja', password }));
  sdk.addEventListener('peerConnected', (e) => log('peerConnected', e.detail.uuid));
  await sdk.connect();
  await sdk.joinRoom({ room, password });
  await sdk.publish(lab.stream, { streamID, media });
  return streamID;
};

lab.view = async ({ room, password, streamID }) => {
  const sdk = (lab.sdks.main = new VDONinjaSDK({ salt: 'vdo.ninja', password }));
  sdk.addEventListener('track', ({ detail }) => {
    log('track', detail.track.kind);
    attach(detail.streams?.[0] || new MediaStream([detail.track]));
  });
  await sdk.connect();
  await sdk.joinRoom({ room, password });
  await sdk.view(streamID, { audio: false, video: true });
};

// Change capture size/fps at the source (saves capture + encode CPU), and cap
// the encoder via the SDK's live sender-parameter API (no renegotiation).
lab.setProfile = async ({ width, height, fps, maxBitrate }) => {
  const track = lab.stream.getVideoTracks()[0];
  await track.applyConstraints({ width: { exact: width }, height: { exact: height }, frameRate: { max: fps }, resizeMode: 'crop-and-scale' });
  const video = { frameRate: fps };
  if (maxBitrate) video.maxBitrate = maxBitrate;
  await lab.sdks.main.updatePublisherMedia(maxBitrate ? { media: { video } } : { clear: true });
  return lab.senderInfo();
};

lab.senderInfo = () => {
  const params = [];
  for (const { owner, pc } of allPcs())
    for (const s of pc.getSenders()) if (s.track?.kind === 'video') params.push({ owner, enc: s.getParameters().encodings });
  return { capture: lab.stream.getVideoTracks()[0].getSettings(), senderParams: params };
};

// ---------------------------------------------------------------- Experiment 2
// Use VDO.Ninja only to bootstrap a data channel, then run our own signaling.

lab.bootstrap = ({ key, room, password, streamID }) =>
  new Promise(async (resolve, reject) => {
    const sdk = (lab.sdks[key] = new VDONinjaSDK({ salt: 'vdo.ninja', password }));
    sdk.addEventListener('dataChannelOpen', (e) => {
      log('vdo dataChannelOpen', key, e.detail.uuid);
      resolve(e.detail.uuid);
    });
    // Remote side opened our app channel ("x-" prefix is reserved for apps).
    sdk.addEventListener('channelOpen', (e) => {
      if (e.detail.label !== 'x-sig') return;
      const ch = e.detail.channel;
      ch.queue = []; // buffer until our Link attaches
      ch.onmessage = (m) => ch.queue.push(m);
      (lab._sigChannels ||= {})[key] = ch;
    });
    try {
      await sdk.autoConnect({ room, password, streamID, mode: 'half' });
    } catch (err) {
      reject(err);
    }
    setTimeout(() => reject(new Error('bootstrap timeout')), 30000);
  });

// Our own signaling: perfect negotiation over a pluggable transport. Each link
// also has a pre-negotiated 'ctl' data channel; once it opens, signaling moves
// onto it and the bootstrap transport is no longer needed.
class Link {
  constructor(peer, polite, send) {
    this.peer = peer;
    this.polite = polite;
    this.transport = 'bootstrap';
    this.counts = {};
    this.remoteTracks = [];
    this._send = send;
    this.pc = new RTCPeerConnection({ iceServers: STUN });
    this.pc.onnegotiationneeded = async () => {
      try {
        this.makingOffer = true;
        await this.pc.setLocalDescription();
        this.send({ description: this.pc.localDescription });
      } catch (e) {
        log('negotiation error', e);
      } finally {
        this.makingOffer = false;
      }
    };
    this.pc.onicecandidate = ({ candidate }) => candidate && this.send({ candidate });
    this.pc.ontrack = ({ track, streams }) => {
      this.remoteTracks.push(track.kind);
      attach(streams[0] || new MediaStream([track]));
    };
    this.ctl = this.pc.createDataChannel('ctl', { negotiated: true, id: 0 });
    this.ctl.onopen = () => {
      log('ctl open with', peer, '- switching signaling off bootstrap');
      this.transport = 'ctl';
      this._send = (m) => this.ctl.send(JSON.stringify({ sig: m }));
    };
    this.ctl.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.sig) this.receive(m.sig);
      else onAppMessage(this, m);
    };
  }

  send(m) {
    this.counts[this.transport] = (this.counts[this.transport] || 0) + 1;
    this._send(m);
  }

  async receive({ description, candidate }) {
    try {
      if (description) {
        const collision = description.type === 'offer' && (this.makingOffer || this.pc.signalingState !== 'stable');
        this.ignoreOffer = !this.polite && collision;
        if (this.ignoreOffer) return;
        await this.pc.setRemoteDescription(description);
        if (description.type === 'offer') {
          await this.pc.setLocalDescription();
          this.send({ description: this.pc.localDescription });
        }
      } else if (candidate) {
        try {
          await this.pc.addIceCandidate(candidate);
        } catch (e) {
          if (!this.ignoreOffer) throw e;
        }
      }
    } catch (e) {
      log('receive error', e);
    }
  }

  sendVideo(maxBitrate = 60_000, maxFramerate = 10) {
    const track = lab.stream.getVideoTracks()[0].clone();
    this.pc.addTransceiver(track, {
      direction: 'sendrecv',
      streams: [new MediaStream([track])],
      sendEncodings: [{ maxBitrate, maxFramerate, scaleResolutionDownBy: 4 }],
    });
  }
}

function waitFor(pred, ms = 20000, what = 'condition') {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const tick = () => {
      if (pred()) return resolve();
      if (Date.now() - t0 > ms) return reject(new Error(`timeout waiting for ${what}`));
      setTimeout(tick, 100);
    };
    tick();
  });
}

// Initiator opens x-sig on the SDK's existing data path; the other side waits for it.
lab.linkViaVdo = async ({ key, uuid, peer, initiator }) => {
  let ch;
  if (initiator) {
    ch = await lab.sdks[key].openChannel(uuid, 'sig');
  } else {
    await waitFor(() => lab._sigChannels?.[key], 20000, 'x-sig channel');
    ch = lab._sigChannels[key];
  }
  log('x-sig open on', key, 'to', peer);
  const link = (lab.links[peer] = new Link(peer, !initiator, (m) => ch.send(JSON.stringify(m))));
  ch.onmessage = (e) => link.receive(JSON.parse(e.data));
  for (const e of ch.queue || []) ch.onmessage(e);
  link.sendVideo();
  await waitFor(() => link.pc.connectionState === 'connected' && link.transport === 'ctl', 20000, `link ${peer}`);
  return lab.linkState(peer);
};

// App messages on ctl: relay envelopes and introductions (hub-mediated mesh).
function onAppMessage(fromLink, m) {
  if (m.relay) {
    const { to, from, sig } = m.relay;
    if (to !== lab.name) {
      lab.relayed = (lab.relayed || 0) + 1;
      return lab.links[to].ctl.send(JSON.stringify(m)); // we're the hub: forward
    }
    let link = lab.links[from];
    if (!link) {
      log('relayed offer from', from, 'via', fromLink.peer);
      link = lab.links[from] = relayLink(from, fromLink.peer, true);
      link.sendVideo();
    }
    link.receive(sig);
  } else if (m.intro) {
    log('introduced to', m.intro, 'by', fromLink.peer);
    const link = (lab.links[m.intro] = relayLink(m.intro, fromLink.peer, false));
    link.sendVideo();
  }
}

function relayLink(peer, hub, polite) {
  return new Link(peer, polite, (sig) =>
    lab.links[hub].ctl.send(JSON.stringify({ relay: { to: peer, from: lab.name, sig } })),
  );
}

lab.introduce = (a, b) => lab.links[a].ctl.send(JSON.stringify({ intro: b }));

lab.teardownVdo = async () => {
  for (const sdk of Object.values(lab.sdks)) await sdk.disconnect();
  const sdkPcs = allPcs().filter((p) => p.owner.startsWith('sdk:') && p.pc.connectionState !== 'closed');
  lab.sdks = {};
  return { openSdkPcs: sdkPcs.length };
};

lab.dropLink = (peer) => {
  lab.links[peer].pc.close();
  delete lab.links[peer];
};

lab.addAudio = (peer) => {
  const ctx = new AudioContext();
  const osc = ctx.createOscillator();
  const dst = ctx.createMediaStreamDestination();
  osc.connect(dst);
  osc.start();
  lab.links[peer].pc.addTrack(dst.stream.getAudioTracks()[0], dst.stream);
};

lab.linkState = async (peer) => {
  const l = lab.links[peer];
  if (!l) return null;
  return {
    state: l.pc.connectionState,
    transport: l.transport,
    sigMsgs: l.counts,
    remoteTracks: l.remoteTracks,
    ...(await videoStats(l.pc)),
  };
};
