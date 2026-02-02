# VDO Samurai

A peer-to-peer application for screen sharing and recording. No central servers required. Recordings are captured locally and transferred to the host after the session for high-quality compositing.

> [!WARNING]
> This is a vibe-coded project written with AI. Nothing other than this note was written by hand. No guarantees are offered. If you want changes, fork it and vibe your own.

Inspired by [VDO.Ninja](https://vdo.ninja), but built for a different use case: **maximum quality local recordings** from each participant, transferred and composited after the session ends.

## How It Works

Each participant records their own video locally at full quality. When the session ends, recordings are transferred directly to the host via P2P, who can then composite and export the final video.

**The timeline is captured during the session.** As the host switches between participants (clicking to focus different speakers), those edit decisions are recorded in real-time. When recording stops, the compositing timeline is already built for you - no manual syncing or editing required. Just review and export.

This approach ensures **maximum quality** regardless of network conditions during the call. Unlike cloud recording services that depend on real-time bandwidth, VDO Samurai captures pristine local footage and syncs it afterwards.

**Hosts must use the desktop app.** Compositing requires local file system access and FFmpeg with more memory than browsers can provide. Participants can join via browser - their recordings are transferred to the host for processing.

## Features

- **Local-First Recording** - Every peer records themselves locally, no quality loss from streaming
- **P2P File Transfer** - Recordings sent directly to host after session, no cloud upload
- **Video Compositing** - Host combines all recordings with FFmpeg for final export
- **Decentralized** - Uses Trystero with WebTorrent trackers for signaling, no account needed
- **P2P Screen Sharing** - Share your screen directly with peers using WebRTC
- **Browser Participants** - Guests can join via browser, no download required

## Quick Start

### Hosting a Session (Desktop App)

1. Download the desktop app from [Releases](https://github.com/dsmmcken/vdo-samurai/releases)
2. Create a room
3. Share the link with participants

### Joining a Session (Browser)

Participants can join directly in their browser at **[dsmmcken.github.io/vdo-samurai](https://dsmmcken.github.io/vdo-samurai)**

Just paste the share link or room code to join.

## Tech Stack

- **Electron + React** - Cross-platform desktop app
- **WebRTC** - Real-time peer-to-peer video streaming
- **Trystero** - Decentralized signaling via WebTorrent trackers
- **FFmpeg** - Video processing and compositing
- **Zustand** - State management
- **TypeScript** - Full type safety

## Development

```bash
# Install dependencies
npm install

# Start development (Electron)
npm run dev

# Start development (Browser)
npm run dev:web

# Test Electron host + browser participant together
npm run dev:dual

# Build for production
npm run build        # Electron
npm run build:web    # Browser

# Package for distribution
npm run package
```

### Commands

```bash
npm run dev          # Start Electron with hot reload
npm run dev:web      # Start browser dev server
npm run dev:dual     # Launch Electron host + browser participant
npm run lint         # Run ESLint
npm run format       # Format with Prettier
npm run tsc          # Type check
npm run test:e2e:headless  # Run E2E tests
```

### Windows Development (WSL)

For developing on Windows with WSL:

```bash
# Terminal 1: Start the dev server
npm run dev:server

# Terminal 2: Run Windows Electron
npm run dev:win
```

Requires Electron installed globally on Windows: `npm install -g electron`

## Project Structure

```
electron/
  main/           # Main process, IPC handlers, FFmpeg
  preload/        # Context bridge for renderer
src/
  components/     # React components
  pages/          # HomePage, SessionPage, CompositePage
  services/       # P2P, recording, compositing logic
  store/          # Zustand state stores
  hooks/          # Custom React hooks
  types/          # TypeScript definitions
e2e/
  tests/          # Playwright E2E tests
  fixtures/       # Test fixtures (Electron + browser)
```

## License

MIT
