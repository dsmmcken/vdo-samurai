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
| Scripted animations: JavaScript canvas animations (intros, outros, title cards) that go on stage like a tile. Each room keeps a library that every browser in it stores (OPFS), so it's there in later meetings. | `src/lib/animation-*.ts`, `src/lib/animations.ts` |

Rules for the edit:
- The picture follows the director's stage log.
- A screen on stage gets the presenter's camera as a small overlay with a soft shadow, 32 px in from a corner: rounded rectangle, square or circle, or hidden. Hovering it pops out the shape / hide icons; dragging moves it to another corner. Anyone can change it before a take (only the Shōgun during one); changes glide / morph live for everyone and in the final cut.
- While someone's camera is off, their initials show instead of black video, live and in the final cut.
- The end screen is a grid of every camera, with no names.
- Each person's name and subtitle show as a lower third for 5 s the first time they're on stage.
- Audio is the director plus whoever is on stage; on the end screen, everyone. Each voice is polished in the render: 80 Hz high-pass (24 dB/oct), de-esser, slow leveler (±12 dB, holds in silence), gentle 3:1 compressor, then loudness-normalized to −16 LUFS (ITU-R BS.1770; gain capped so peaks only lightly touch the limiter). The mix goes through a 5 ms look-ahead limiter at −1.5 dBFS. Per-person numbers are in the render's Recording details. (`src/compositor/voice.ts`)

## Scripted animations

Short JavaScript canvas animations for intros, outros and interstitials. A script calls `samurai.animation({ name, duration, end, microphones, draw, audio, assets })` once; `draw(ctx, t, animation)` paints one 1920×1080 frame as a pure function of `t`.

- **The window** (⋯ → Scripted animations): the room's library on the left (a switch per animation gives it a tile in the strip; delete on hover); on the right a Preview / Code tab per animation. Preview has its length, ending and microphones as controls: a change rewrites just that value in the script (`src/lib/animation-edit.ts`) and saves a new version for everyone. Code is the editor, with embedded files shown as `⟨file N⟩` markers. **New animation** takes a pasted or dropped `.js` file or the built-in 5-second VDO.Samurai intro. Files go last in a script, and may be placeholders (`assets: { logo: 'image' }`): the editor asks for each and puts it in. **Create with AI** shows the prompt to copy into your own assistant (API, rules, the JSON Schema, an example).
- **Playing.** A tile works like any other: anyone can click it, and during a take only the Shōgun. It starts 0.6 s after the click on a shared clock; each browser draws it at 30 fps and plays its sound. At the end it goes back to what was on before (`'prev'`), holds, loops, or goes to the tile N places along the strip (`{ tile: N }`, wrapping).
- **Final cut.** The Shōgun keeps the exact script that played with the take; the render draws its frames in the same sandbox, mixes its sound at the cue times (not through anyone's mic), and keeps only the microphones it asks for (`microphones: 'none' | 'director' | 'all'`).
- **Sandbox** (`src/lib/animation-host.ts`). Scripts come from anyone in the room, so they run in workers inside a hidden `<iframe sandbox="allow-scripts">`: an opaque ("null") origin, so no access to this app's storage, cookies or pages, and a CSP of `default-src 'none'`, so no network. Chrome runs it in a process of its own. Inside, the worker also removes network, storage and code-from-string APIs before the script runs, and refuses `import()`. Loading and each frame are time-limited. Frames come back as pictures over a MessagePort; the render worker has the page start its sandboxes. `Math.random`, `Date.now` and `performance.now` are deterministic, so live and render match.
- **Validation.** What a script declares is checked on the page against a JSON Schema (`ANIMATION_SCHEMA`, small validator in `src/lib/json-schema.ts`). Unknown properties are refused, so a typo is an error, not an ignored option.
- **Library sync.** Per name, two last-writer-wins registers stamped with wall-clock time (never behind any stamp seen): the content (which version, or deleted) and whether it has a tile. Two people who edit the same animation apart, then meet, both end up with the later edit. Scripts (5 MB max, files included) travel by sha-256 on their own data channel, after any take upload, only from someone who says they have it. A tile plays once everyone present has that version.

## Develop

```sh
npm install
npm run dev          # http://localhost:8080
npm run build        # static site in dist/
```

`.github/workflows/pages.yml` deploys `dist/` to GitHub Pages on every push to `main`. The build uses relative paths, so it works under `user.github.io/<repo>/`.

## Test

`npm run test:animations` checks scripted animations in headless Chromium: the library's merge rules, the strip, the schema, editing scripts as text, and the sandbox (null origin, no network, what a script can reach, deterministic frames, time limits, the render's path through the page).

`npm run test:e2e` builds the app, then runs three headless Chromium peers through the real `wss.vdo.ninja`. They join (one by typing the password), pass the director role around, reorder tiles, rename someone, share a (fake) screen, record a take with stage switches and an animation (added by a guest, played by the Shōgun), upload, render, and check that guests' storage is emptied and the animation's frames and sound are in the cut. The final video lands in `test-results/final.mp4`.

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
