# VDO Samurai

A browser-only meeting room for recording sessions. The live meeting uses tiny, low-CPU video. Each person records full quality locally, and the director's browser cuts the final 1080p30 H.264 MP4.

VDO.Ninja's hosted signaling server is only used so people can find each other. Media, room state and file transfers run over our own peer-to-peer connections.

## How it works

| Piece | Where |
| --- | --- |
| Room link: `#room=<name>`. The password is never in the link: invitees type it, and it's kept in the tab's session storage. | `src/lib/identity.ts` |
| Mesh: VDO.Ninja `autoConnect` (half mode) opens one data link per pair. Over it we negotiate our own `RTCPeerConnection`, then signaling moves to its own `ctl` channel. | `src/lib/mesh.ts`, `src/lib/link.ts` |
| Live media: capture once at 1080p; each sender is downscaled and capped (tile 180p, 120 kbps). Only the person on stage sends more. Screen previews are sent only while on stage. | `src/lib/media.ts` |
| Shared state: director, tile order, stage and take are last-writer-wins registers, gossiped over every link. | `src/lib/room.ts` |
| Timing: NTP-style pings per link. The take starts at a fixed instant on the director's clock, and each file records where it starts on the take's timeline. | `src/lib/room.ts` |
| Recording: WebCodecs in a worker → fragmented MP4 in OPFS, camera and screen as separate files. Timing doesn't trust the browser's absolute timestamps (on Windows the first mic chunks can be seconds off): audio time is a sample count, video keeps its frame spacing, and each track's start is the earliest arrival seen. Recorders start when Record is pressed, before the countdown, so the encoder start-up hiccup never lands in the take. If capture fails mid-take, recording continues with `MediaRecorder`. Each person's recorder log is in ⋯ → Recording details. | `src/lib/recorder.ts`, `src/lib/capture-worker.ts` |
| Upload: resumable data-channel transfer to the director. Files are deleted locally once the director confirms. | `src/lib/room.ts` |
| Final cut: Mediabunny + WebCodecs in a Web Worker, written straight to OPFS. | `src/compositor/` |

Rules for the edit:
- The picture follows the director's stage log.
- A screen on stage gets the presenter's camera as a small portrait rounded rectangle with a soft shadow, 32 px in from a corner. Anyone can drag it to another corner before a take (only the director during one); the move glides live and in the final cut.
- While someone's camera is off, their initials show instead of black video, live and in the final cut.
- The end screen is a grid of every camera, with no names.
- Each person's name and subtitle show as a lower third for 5 s the first time they're on stage.
- Audio is the director plus whoever is on stage; on the end screen, everyone. Each person is loudness-normalized to −18 LUFS (ITU-R BS.1770, gain limited to ±12 dB) and the mix goes through a limiter; the measured levels are in the render's Recording details.

## Develop

```sh
npm install
npm run dev          # http://localhost:5173
npm run build        # static site in dist/
```

`.github/workflows/pages.yml` deploys `dist/` to GitHub Pages on every push to `main`. The build uses relative paths, so it works under `user.github.io/<repo>/`.

## Test

`npm run test:e2e` builds the app, then runs three headless Chromium peers through the real `wss.vdo.ninja`. They join (one by typing the password), pass the director role around, reorder tiles, rename someone, share a (fake) screen, record a take with stage switches, upload, render, and check that guests' storage is emptied. The final video lands in `test-results/final.mp4`.

- `RELOAD_DIRECTOR=1` reloads the director right after Stop, to exercise upload resume.
- `STATS=1` prints what each person sends live.
- `CHROME=/path/to/chrome` picks the browser binary.
- `DIRECTOR_SCREEN=1` has the director share a still screen mid-take and flip the stage to it, then checks the final cut shows it.
- `FAIL_AUDIO=1` makes the director's audio encoder fail mid-take, to exercise the switch to the backup recorder; `REPORT=1` prints the director's recording report.
- The fake camera, screen and mic encode the wall clock (a barcode in the picture, beeps on every 7th second), and the test prints how far each lands from where it should be in the final cut.

## Known limits

- **No TURN.** Our connections use public STUN only. Two people whose networks need a relay won't see each other; the "N here" count shows it.
- **Audio codec.** The final cut uses AAC where the browser can encode it (Chrome on Windows and macOS) and Opus in MP4 otherwise (Chrome on Linux).
- **Not yet exercised by tests:**
  - real cameras and screens, 8 people, or 20-minute takes;
  - joining mid-recording.
