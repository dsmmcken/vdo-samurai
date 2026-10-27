# Technical Exploration: Specialized Client on VDO.Ninja

Date: 2026-10-27
Status: research and experiments done. No product code yet.

## Goal

Build a specialized browser client and host that use VDO.Ninja's hosted signaling server to connect peers, then:

- run the live meeting at **very low bitrate and CPU**;
- let a **host** signal events such as start and stop recording;
- have each client **record locally at full resolution** and transfer the file **peer-to-peer** to the host when recording ends;
- have the host **composite all recordings** into one full-quality render, in the browser.

Target workload: sessions of **up to 8 participants**, with recordings of about **20 minutes**.

## Summary of findings

| Question | Answer | Evidence |
|---|---|---|
| Can our client force very low bitrate and CPU on the live meeting? | **Yes** | Measured against live VDO.Ninja (Experiment 1) |
| Can VDO.Ninja bootstrap our own peer-to-peer signaling? | **Yes** | Six-step experiment passed (Experiment 2) |
| Do we need our own STUN/TURN? | **Not if we stay on the SDK's connections.** A new connection of our own needs STUN, plus TURN for strict networks. | Analysis |
| Can a client record 20 minutes in the browser and upload it automatically? | **Yes**, with storage and resume handled carefully | Analysis of browser capabilities |
| Can a host browser composite 8 × 20 min of 1080p? | **Yes, in about 6–7 min** on a GPU desktop | Measured on Windows Chrome with an RTX 2080 SUPER (Experiment 3) |
| Can it all be static hosting (e.g. GitHub Pages) plus VDO.Ninja? | **Technically yes**. The app is static files; all heavy traffic is peer-to-peer. | Architecture |

## Recommended architecture

```
                  wss.vdo.ninja (handshake only)
                     ▲            ▲
                     │ SDP/ICE    │
   ┌─────────────────┴──┐      ┌──┴─────────────────┐
   │ Client (browser)   │◄────►│ Host (browser)     │
   │ low-res live video │ P2P  │ composites final   │
   │ full-res local rec │      │ render (WebCodecs) │
   └────────────────────┘      └────────────────────┘
       one WebRTC connection per pair carries:
       • live video (bitrate-capped)
       • control messages (record start/stop, clock sync)
       • file transfer (data channel)
```

1. **Use `@vdoninja/sdk` for connecting peers** and keep everything on the connections it creates. Don't build a second connection of our own unless we later want to stop depending on the SDK.
2. **Live meeting:** capture a low-res copy for the meeting, cap it per sender with `publish(stream, { media: { video: { maxBitrate } } })`, and adjust live with `updatePublisherMedia()`.
3. **Host control:** use `sdk.sendData()` or `request()`/`onRequest()` over data channels. Record-start carries a clock-sync exchange so recordings can be aligned later.
4. **Local recording:** record full-res with MediaRecorder (MP4), or with WebCodecs plus Mediabunny. Write it in chunks to OPFS (the browser's private file storage) as it records.
5. **Transfer:** use a data channel on the SDK connection (`openChannel(uuid, 'file')` or the SDK's `hostFile`/`requestFile`), with chunking, flow control and resume. Optionally upload in the background during the meeting.
6. **Compositing:** use WebCodecs plus Mediabunny on the host, reading inputs from storage and writing the output to a file as it goes.

## Experiment 1: low-bitrate live video

Setup: one publisher and one viewer in separate headless Chromium instances, connected through the live `wss.vdo.ninja` server via the SDK (v1.6.2). Fake 720p camera, software VP8.

| Profile | Sent | Resolution / fps | Sender encoder busy | Sender browser CPU | Viewer browser CPU |
|---|---|---|---|---|---|
| 720p uncapped | 684 kbps | 1280x720 @20 | 4.6% | 15.4% | 10.2% |
| 300k cap | 297 kbps | 640x480 @15 | 2.4% | 5.9% | 5.3% |
| 100k cap | 101 kbps | 320x240 @10 | 0.8% | 3.6% | 3.6% |
| 40k cap, set at publish time | 40 kbps | 160x120 @8 | 0.2% | 3.9% | 4.2% |
| 20k cap | 16 kbps | 96x96 @5 | 0.2% | 2.4% | 1.9% |

Findings:
- The SDK applies `maxBitrate` exactly as requested, on the encoder itself, with no renegotiation needed.
- **Bandwidth drops about 30–40×**, and encode/decode CPU becomes negligible. The remaining 2–4% is the browser's own overhead.
- **Capture resolution and frame rate are the biggest CPU lever**, more than the bitrate cap alone.
- In a mesh, each participant encodes once per other participant, so per-stream savings multiply with group size.

Caveats:
- The fake camera produces easy-to-compress images. A real 720p webcam typically needs 1.5–2.5 Mbps uncapped.
- Changing resolution mid-call on the fake camera gave odd sizes. Set the low resolution at capture time.

## Experiment 2: bootstrapping our own signaling

Setup: three peers (hub, Alice, Bob). Alice and Bob each meet the hub through VDO.Ninja, in separate rooms.

| Step | Result |
|---|---|
| 1. Bootstrap via VDO.Ninja (SDK `autoConnect`) | Passed |
| 2. Negotiate a new `RTCPeerConnection` of our own over an SDK app channel (`openChannel(uuid, 'sig')`) | Passed: 214 ms, 3 messages |
| 3. Move signaling onto our connection's own data channel | Passed |
| 4. Disconnect everyone from VDO.Ninja | Passed: 0 SDK connections left; video kept flowing (10 fps, 29 kbps) |
| 5. Renegotiate (add an audio track) with VDO.Ninja gone | Passed |
| 6. Hub introduces Alice to Bob and relays their setup messages | Passed: Alice and Bob connected directly; their link survived the hub leaving |

Conclusion: VDO.Ninja is only needed for the first introduction. We *can* run an independent mesh afterwards, but the recommended architecture doesn't need to.

## Connectivity: STUN, TURN and NAT traversal

- **The signaling server doesn't do NAT traversal.** STUN and TURN do. VDO.Ninja's SDK fetches its own STUN/TURN for the connections it creates.
- **Every new connection does its own NAT traversal from scratch.** A connection of our own (Experiment 2 style) can't reuse the SDK's path. It needs STUN, which Google provides free at `stun.l.google.com:19302`, plus TURN for users on strict networks (commonly cited as 10–20% of sessions).
- **Google offers no free TURN.** Options: Cloudflare's TURN service (has a free monthly allowance; check current pricing), self-hosted coturn, or small free tiers like Metered's Open Relay (for testing only).
- **We can detect the route.** The selected candidate pair in `getStats()` shows `host`/`srflx`/`prflx` (direct) or `relay` (TURN). The experiment harness already reads this.
- **The host can't act as the TURN server** for its own connections. If a client can't reach the host directly, it can't reach a TURN server running on the host either. The host *can* relay live traffic between clients that each reach it directly.

## Large file transfer without a TURN server of our own

Plan:
1. **Direct route** (most connections): send over a data channel on the SDK connection. This is true peer-to-peer.
2. **Relayed route:** fall back to one of:
   - **peer relay**: another participant who can reach both forwards the file;
   - **cloud upload**: e.g. Cloudflare R2, then the host downloads.

Other peer-to-peer techniques researched (all of them still keep a relay for the hardest cases):

| Technique | Works in a browser? | Notes |
|---|---|---|
| IPv6 | Yes, automatically | No NAT on most IPv6, so often direct. Browsers already try it. |
| Peer relay | Yes | Costs the relaying participant's bandwidth |
| Router port mapping (UPnP / NAT-PMP / PCP) | No, native app only | Makes a user reachable directly |
| Aggressive hole punching (libp2p DCUtR, iroh) | No, native app only | libp2p measured **70% ± 7%** success over 4.4M attempts. Iroh's ~90% claim is unverified. Coordination could run over our existing data channel. |

No common method reaches 100% direct. Every major peer-to-peer system (libp2p, iroh, Tailscale, Syncthing) keeps a relay fallback.

## Client-side recording (20 minutes, browser)

- **Size:** 1080p at about 5–8 Mbps is roughly **0.75–1.2 GB** per 20 minutes; 720p is about 400–600 MB.
- **Storage:** write to OPFS in roughly one-second chunks rather than holding it in memory. A tab crash keeps everything recorded so far.
- **Format:** Chrome's WebM recordings lack duration and seek metadata; prefer MP4, or WebCodecs plus Mediabunny.
- **Upload time** depends on the client's home upload speed: 1 GB at 20 Mbps takes about 7 minutes. Uploading in the background during the meeting brings the post-meeting wait close to zero.
- **CPU trade-off:** a full-res recording means a full-res capture and one full-res encode per client while recording. The meeting stays cheap because nobody sends or decodes high-quality video per peer.
- **Risks:** the user closes the tab (warn on leave; OPFS keeps the data) or the laptop sleeps.
- **Sync:** record-start comes with a clock-sync exchange (round-trip pings). Compose by output timestamp, taking each input's latest frame, since recordings have variable frame rates. Audio clocks drift by milliseconds per minute; correct this if needed.

## Experiment 3: host compositing benchmark

Setup: 8 distinct synthetic 1080p30 H.264 clips (6 Mbps, grain noise, AAC audio). The page decodes all 8 with WebCodecs via Mediabunny, draws a 3x3 grid on a 1080p canvas, mixes the audio, and encodes H.264 + AAC to MP4.

**Windows Chrome 155, RTX 2080 SUPER (Direct3D 11), 32 threads; 8 clips × 60 s:**

| Run | Speed | Estimate for 8 × 20 min |
|---|---|---|
| Composite, browser default (×2) | 3.03× / 3.12× real time | ~6–7 min |
| Decode only | 3.34× | ~6 min |
| Composite, forced software codecs | 3.21× | ~6 min |
| *Sandbox: headless Linux, no GPU access (8 × 15 s)* | *0.25×* | *~1 h 21 min* |

Per-frame timing:

| | Decoder wait | Grid drawing | Encoder wait |
|---|---|---|---|
| Windows, default | 0.4 ms | 1.0 ms | 8 ms |
| Windows, forced software | 0.3 ms | 5.6 ms | 3.1 ms |
| Sandbox, no GPU | 1.7 ms | **128 ms** | 0.5 ms |

Findings:
- **Feasible in the browser.** About 3× real time on a GPU desktop.
- **Decoding sets the speed limit.** Decode-only was barely faster than the full composite.
- **What matters is GPU canvas drawing, not hardware codecs.** Forced software codecs were just as fast on a 32-thread CPU. With no GPU, drawing grows to 128 ms per frame. Hosts need Chrome's graphics acceleration enabled; integrated graphics should be fine (untested).
- **No GPU-accelerated video in the dev sandbox:** the RTX 2080 is visible to `nvidia-smi`, but the WSL video libraries (NVENC/NVDEC, D3D12, VA-API) aren't present, so Chromium and ffmpeg fall back to software. Real-hardware numbers must come from a desktop browser.

Before production:
- **Memory:** the benchmark loads all inputs into memory and builds the output in memory. At 20 minutes that's about 7 GB of input plus 1.2 GB of output. Read from OPFS or disk files, and write the output to a file as it goes (Mediabunny supports both).
- **Real recordings:** benchmark with actual MediaRecorder output, not synthetic clips.
- **Weaker hosts:** test laptops with integrated graphics. If drawing becomes the bottleneck, split it across workers or use WebGL.

## Hosting

- The app is entirely static (HTML, JS, the SDK), so any static host works (GitHub Pages, Cloudflare Pages, Netlify). Media and files never touch the host, so bandwidth is negligible.
- **Same-origin catch on GitHub Pages:** every project at `user.github.io/*` shares one origin, and therefore one OPFS storage space. Use a custom domain to give the app its own.
- Pages must be served over HTTPS (or localhost) for camera, WebCodecs and OPFS.
- Open-source Chromium has no AAC encoder; branded Chrome and Edge do. The benchmark falls back to Opus in MP4.

## Recommendations

1. Build on `@vdoninja/sdk`. Keep live video, control and file transfer on the SDK's connections, and use its WebSocket for the handshake only.
2. Capture at a low resolution for the meeting (e.g. 160x120–320x180 at 8–10 fps, capped at 20–100 kbps), recording full-res separately.
3. Record to OPFS in chunks; transfer over data channels with chunking, flow control and resume. Consider uploading during the meeting.
4. Log each connection's route type (direct vs relayed) from the first real sessions to learn how many users will need the fallback.
5. File-transfer fallback for relayed users: peer relay, then cloud upload.
6. Composite on the host with WebCodecs plus Mediabunny, streaming from and to storage. Require Chrome or Edge with graphics acceleration.
7. Keep a path open to swap in our own signaling server later. The SDK accepts a custom `host`.

## Next experiments

- End-to-end prototype: host record-start event → clients record full-res while sending low-res (measure CPU) → transfer to host on stop (measure throughput) → composite.
- Measure route types from a few real networks.
- Benchmark compositing on a laptop with integrated graphics, and with real 20-minute recordings.
- Check audio drift and alignment across devices over 20 minutes.

## Reproducing

All code is in `experiments/` (uncommitted).

| Experiment | Location | Command |
|---|---|---|
| 1. Bitrate / CPU | `experiments/vdoninja-probe/` | `node run-bitrate.mjs` (prefix `INITIAL=1` for the publish-time cap) |
| 2. Signaling bootstrap | `experiments/vdoninja-probe/` | `node run-signaling.mjs` |
| GPU probe | `experiments/vdoninja-probe/` | `node gpu-probe.mjs` |
| 3. Compositing | `experiments/composite-bench/` | `./make-clips.sh`, then `node server.mjs` and open `http://localhost:8080/`; headless: `node run-headless.mjs composite 8 15` |

Raw results are in each folder's `results/` directory (git-ignored).

### Sources
- [VDO.Ninja SDK (`@vdoninja/sdk`)](https://www.npmjs.com/package/@vdoninja/sdk)
- [Large-scale measurement of decentralized NAT traversal (libp2p DCUtR)](https://arxiv.org/html/2510.27500v1)
- [ProbeLab: Can libp2p punch through NATs?](https://probelab.io/blog/can-libp2p-punch-through-nats/)
- [iroh: hole punching](https://docs.iroh.computer/concepts/holepunching)
- [How NAT traversal works (summary of Tailscale's post)](https://pinggy.io/blog/how_nat_traversal_works/)
- [WebRTC IPv6 ICE candidates](https://oneuptime.com/blog/post/2026-03-20-webrtc-ipv6-ice-candidates/view)
- [Mediabunny](https://mediabunny.dev/)
- [GitHub Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)
