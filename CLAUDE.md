# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

VDO Samurai is a peer-to-peer desktop application for screen sharing and recording. Built with Electron + React, it uses WebRTC for real-time communication, Trystero for decentralized signaling (via WebTorrent trackers), and FFmpeg for video processing. No central servers required.

## Commands

```bash
npm run dev          # Start development with hot reload
npm run build        # Build for production
npm run package      # Build and package for all platforms
npm run package:mac  # Package for macOS only
npm run lint         # Run ESLint
npm run format       # Format code with Prettier
npm run format:check # Check formatting
npm run tsc         # TypeScript type check
npm run test:e2e         # Run E2E tests (visible browser)
npm run test:e2e:headless # Run E2E tests in headless mode (preferred for agents and CI)
npm run test:e2e:ui      # Run with Playwright UI
npm run test:e2e:debug   # Run in debug mode
```

## Architecture

### Electron Structure
- `electron/main/` - Main process: window management, IPC handlers, FFmpeg integration
- `electron/preload/` - Context bridge exposing IPC to renderer
- Dev mode loads from `http://localhost:5173`, production loads built renderer

### React App (`src/`)
- **Pages**: `HomePage` (join/create), `SessionPage` (video conference), `CompositePage` (video editing)
- **State**: Zustand stores in `store/` - `sessionStore`, `peerStore`, `recordingStore`, `userStore` (persisted), `transferStore`, `compositeStore`
- **Services**: Business logic in `services/` - P2P (`PeerManager`, `SignalingService`), recording (`LocalRecorder`, `RecordingCoordinator`), compositing (`CompositeService`, `FFmpegService`)
- **Hooks**: `useWebRTC`, `useMediaStream`, `useScreenShare`, `useRecording`, `useComposite`, `useFileTransfer`

### P2P Communication
- Trystero handles signaling via WebTorrent trackers (no central server)
- `PeerManager` manages WebRTC connections and streams
- Config in `services/p2p/config.ts` defines tracker URLs and STUN servers

### IPC Channels
Key Electron IPC handlers in `electron/main/ipc-handlers.ts`:
- `screen-capture:getSources` - Desktop capture sources
- `ffmpeg:composite` / `ffmpeg:cancel` / `ffmpeg:trimVideo` - Video processing
- `storage:*` - File system operations

## Key Patterns

- Functional components with hooks exclusively
- Zustand for state (no Context API)
- Service layer separates business logic from UI
- HashRouter for Electron compatibility
- Recording chunks stored in IndexedDB
- FFmpeg bundled as external resource (see `electron-builder.yml`)

## TypeScript

Strict mode enabled. Types in `src/types/`:
- `index.ts` - Peer, Session interfaces
- `messages.ts` - P2P message types
- `electron.d.ts` - Electron IPC types

## E2E Testing

End-to-end tests use Playwright with Electron. Tests run against the built app (requires `npm run build` first).

### Structure (`e2e/`)
- `playwright.config.ts` - Config: 3min timeout, single worker, artifacts on failure
- `fixtures/electron-app.ts` - App launcher with media mocking
- `helpers/selectors.ts` - Centralized UI selectors
- `helpers/wait-helpers.ts` - Common wait utilities
- `helpers/video-verify.ts` - Video validation helpers
- `tests/*.spec.ts` - Test files

### Media Mocking
Tests inject canvas-based mock streams for camera/screen share:
- Host streams: Blue (camera) / Purple (screen)
- Participant streams: Pink (camera) / Red (screen)
- Streams display user name, type label, and frame counter
- Electron's `screenCapture.getSources` is also mocked

### Writing Tests
```typescript
import { test, expect } from '@playwright/test';
import { launchApp, closeApp, AppInstance } from '../fixtures/electron-app';
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

Use `selectors.ts` for UI elements. Each `launchApp()` creates an isolated Electron instance with separate userData.
