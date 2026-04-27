# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

VDO Samurai is a peer-to-peer screen-sharing and recording app, inspired by VDO.Ninja but optimized for **maximum-quality local recordings**. Each peer records itself locally; recordings are transferred P2P to the host after the session, where FFmpeg composites them. The host must run the Electron desktop app (file system + FFmpeg); participants can join via the browser build.

The host's focus changes during the session are recorded as a timeline so the composite is pre-edited when the call ends.

> Per the README, this is a "vibe-coded" project. There is no formal QA — confirm behavior empirically and prefer adding/extending E2E tests over inferring behavior from comments.

## Commands

```bash
# Develop
npm run dev          # Electron with hot reload (sets SIMULATE_MEDIA=true, INSTANCE_ID=host)
npm run dev:web      # Browser-only dev server (Vite)
npm run dev:dual     # Launches Electron host + browser participant simultaneously
npm run dev:server   # Vite dev server only (used by dev:win for WSL workflow)
npm run dev:win      # Run Windows Electron against WSL dev server

# Build / package
npm run build        # Build Electron renderer + main + preload
npm run build:web    # Build browser bundle (output: dist-web/)
npm run package      # Package all platforms; package:mac/win/linux for one

# Quality
npm run lint
npm run format / format:check
npm run tsc          # tsc --noEmit

# E2E (Playwright + Electron)
npm run test:e2e:headless   # Preferred for agents/CI
npm run test:e2e            # Visible
npm run test:e2e:ui         # Playwright UI
npm run test:e2e:debug
# Run a single test:
npm run test:e2e:headless -- e2e/tests/room-creation-join.spec.ts
npm run test:e2e:headless -- -g "creates a room"

# Assets
npm run generate:test-videos   # Mock videos for E2E
npm run download:ffmpeg        # Re-runs postinstall ffmpeg download
```

`postinstall` downloads platform FFmpeg/ffprobe binaries into `resources/`. E2E tests run against the **built** app (`out/main/index.js`), so run `npm run build` before `test:e2e*` after changing main/preload code.

## Architecture

### Process layout (Electron)
- `electron/main/` — main process. Window, menu, IPC handlers, FFmpeg, custom `media://` protocol, optional in-process media server.
  - `index.ts` — window + protocol bootstrap. Honors `HEADLESS`/`E2E_HEADLESS`, `SIMULATE_MEDIA`, `INSTANCE_ID` env vars (used by E2E and `dev:dual`).
  - `ipc-handlers.ts` — all `ipcMain.handle` registrations.
  - `ffmpeg.ts` / `ffmpeg-timeline.ts` / `ffmpeg-paths.ts` — composite, trim, concatenate, timeline export, plus binary-resolution.
  - `storage.ts` — recording chunk persistence, save dialogs, temp files.
  - `speeddial.ts` + `clip-registry.ts` — speed-dial clip import/thumbnail; `media://clip/<id>` URL resolution.
  - `media-mock.ts` / `media-server.ts` — injected mock streams for `SIMULATE_MEDIA`/E2E.
- `electron/preload/index.ts` — `contextBridge` API surface. Mirror new IPC channels in `src/types/electron.d.ts`.

Dev mode loads `http://localhost:5173`; production loads the bundled renderer. The browser build (`vite.config.web.ts` → `dist-web/`) is deployed by `.github/workflows/deploy-web.yml` for participants.

### Renderer (`src/`)
- **Pages** (`pages/`): `HomePage`, `SessionPage`, `NotFoundPage`. There is no separate composite page — the NLE editor is a component (`components/nle/NLEEditor.tsx`) inside the session.
- **State** (`store/`, all Zustand): `sessionStore`, `peerStore`, `recordingStore`, `transferStore`, `compositeStore`, `nleStore`, `speedDialStore`, `popoverStore`, `userStore` (persisted via `useLocalStorage`).
- **Business logic lives in `src/utils/`** (despite the name) — `LocalRecorder`, `ScreenRecorder`, `ClipRecorder`, `FileTransferProtocol`, `TimelineBuilder`, `ffmpeg` (renderer-side wrapper), `recordingStorage` (IndexedDB), `connectionHistory`, `roomCode`, `compositeConfig`, `recordingConfig`, `transferConfig`, `platform`, `urlParams`, `browserStorage`, `colorHash`. `src/services/` only contains `SpeedDialPlayer.ts`.
- **Hooks** (`hooks/`): `useWebRTC`, `useMediaStream`, `useScreenShare`, `useRecording`, `useComposite`, `useFileTransfer`, `useHostTransfer`, `usePendingTransfers`, `usePeerManager`, `useFocus`, `useEditPoints`, `useClockSync`, `useAudioLevel`, `useTileOrder`, `useVisibility`, `useSpeedDial`, `useDelayedUnmount`, `useConnectionHistory`, `useLocalStorage`.
- **Components** (`components/`): grouped by feature — `connection/`, `recording/`, `transfer/`, `video/`, `nle/`, `speeddial/`, `user/`, `layout/`, `ui/`, plus root-level banners.

### P2P signaling and messaging
- **`src/contexts/TrysteroContext.tsx` is the single source of truth** for the Trystero room and every cross-peer action. New cross-peer messages are added here and exposed through the context, not by calling `joinRoom` from feature code.
- **Trystero strategy is `trystero/nostr`** — signaling rides explicit Nostr relays (see the `NOSTR_RELAY_URLS` list with `RELAY_REDUNDANCY = 5`). The earlier WebTorrent-tracker description is outdated.
- **STUN servers**: Google's public stun1–4 servers are configured directly in `RTC_CONFIG`.
- **Trystero action names are hard-capped at 12 bytes.** Existing actions follow this: `peer-info`, `ss-status`, `ss-active`, `focus-change`, `video-state`, `session-info`, `sess-req`, `tile-order`, `xfer-status`, `host-xfer`, `sd-status`, `mesh-hlth`. New actions must fit in 12 ASCII bytes.
- WebRTC stream attach/detach is handled by `usePeerManager` + `useWebRTC`. Trystero handles signaling and small JSON actions; binary file transfers go through `FileTransferProtocol` over Trystero data channels.

### Recording / transfer / compositing pipeline
1. Each peer captures via `useRecording` → `LocalRecorder`/`ScreenRecorder` → MediaRecorder chunks → IndexedDB (`recordingStorage`).
2. Host's focus changes are tracked by `useFocus` + `TimelineBuilder` to produce a composite timeline.
3. On stop, `useHostTransfer` / `FileTransferProtocol` ships chunks to the host (P2P, chunked, with progress in `transferStore`).
4. Host triggers composite via `useComposite` → IPC (`ffmpeg:composite`, `ffmpeg:timelineExport`, `ffmpeg:trimVideo`, `ffmpeg:cancel`) → `electron/main/ffmpeg*.ts`. Output saved through the storage IPC layer.

### Custom URL scheme
The main process registers a privileged `media://` scheme in `electron/main/index.ts`. URLs of the form `media://clip/<clipId>` resolve via `clip-registry.ts` and are streamable in `<video>`/`<audio>` elements. Use this instead of `file://` for clips imported through speed-dial.

## Conventions

- React 19, functional components + hooks only. No Class components, no Context API for app state (only `TrysteroContext`).
- HashRouter (Electron-friendly).
- TypeScript strict mode. Types in `src/types/`: `index.ts` (Peer, Session), `messages.ts` (P2P payloads), `electron.d.ts` (preload bridge), `recording.ts`, `speeddial.ts`, `export.ts`.
- FFmpeg binaries are bundled as external resources via `electron-builder.yml` — paths are resolved through `electron/main/ffmpeg-paths.ts`, never hardcoded.

## E2E Testing

`e2e/playwright.config.ts` — 3-min timeout, single worker, artifacts on failure. Tests run against the built Electron app and use mock streams (no real camera/mic).

- `fixtures/electron-app.ts` — `launchApp(instanceId)` creates an isolated Electron with its own `userData`. Always pair with `closeApp` in `finally`.
- `fixtures/browser-participant.ts` + `test-server.ts` — for cross-platform tests where one side is the browser build.
- `helpers/selectors.ts` — **always use these selectors instead of inlining strings.**
- `helpers/wait-helpers.ts`, `video-verify.ts`, `store-helpers.ts`, `test-setup.ts` — shared utilities.
- `fixtures/browser-media-mock.ts` injects canvas streams: host = blue (camera) / purple (screen); participant = pink (camera) / red (screen). Each frame shows name + label + frame counter; `video-verify` asserts on these.
- `screenCapture.getSources` is mocked by `electron/main/media-mock.ts` when `SIMULATE_MEDIA=true`.

When running tests:
- Always let them complete — never wrap in `head`, `tail`, or `timeout`.
- Use `npm run test:e2e:headless` for agent runs (sets `HEADLESS=true`).
- Run a single spec or test name with `--` (see Commands above).

```typescript
import { test, expect } from '@playwright/test';
import { launchApp, closeApp } from '../fixtures/electron-app';
import { selectors } from '../helpers/selectors';

test('example', async () => {
  const app = await launchApp('test-instance');
  try {
    await app.page.click(selectors.home.createRoomButton);
    // ...
  } finally {
    await closeApp(app);
  }
});
```
