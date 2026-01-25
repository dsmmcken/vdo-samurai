# VDO Samurai

A peer-to-peer desktop application for screen sharing and recording. No central servers required.

## How It Works

Each participant records their own video locally at full quality. When the session ends, recordings are transferred directly to the host via P2P, who can then composite and export the final video.

This approach ensures **maximum quality** regardless of network conditions during the call. Unlike cloud recording services that depend on real-time bandwidth, VDO Samurai captures pristine local footage and syncs it afterwards.

## Features

- **Local-First Recording** - Every peer records themselves locally, no quality loss from streaming
- **P2P File Transfer** - Recordings sent directly to host after session, no cloud upload
- **Video Compositing** - Host combines all recordings with FFmpeg for final export
- **Decentralized** - Uses Trystero with WebTorrent trackers for signaling, no account needed
- **P2P Screen Sharing** - Share your screen directly with peers using WebRTC

## Tech Stack

- **Electron + React** - Cross-platform desktop app
- **WebRTC** - Real-time peer-to-peer video streaming
- **Trystero** - Decentralized signaling via WebTorrent trackers
- **FFmpeg** - Video processing and compositing
- **Zustand** - State management
- **TypeScript** - Full type safety

## Getting Started

```bash
# Install dependencies
npm install

# Start development
npm run dev

# Build for production
npm run build

# Package for distribution
npm run package
```

## Development

```bash
npm run dev          # Start with hot reload
npm run lint         # Run ESLint
npm run format       # Format with Prettier
npm run tsc          # Type check
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
```

## License

MIT
