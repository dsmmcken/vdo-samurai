# VDO Samurai - P2P Screen Sharing & Recording App

## Overview
A fully client-side, peer-to-peer screen sharing and recording application. No backend server required - uses public BitTorrent trackers for WebRTC signaling via Trystero.

## Tech Stack
- **Framework**: React 18 + TypeScript + Vite
- **Styling**: Tailwind CSS
- **P2P Signaling**: Trystero (BitTorrent tracker strategy)
- **State Management**: Zustand
- **Video Compositing**: FFmpeg.wasm (with coi-serviceworker for GitHub Pages)
- **Persistence**: localStorage (connections), IndexedDB (recordings)

## Configuration
- **Expected Participants**: 5-8 people (mesh topology with connection optimization)
- **Typical Recording Duration**: 15-60 minutes (chunked processing for compositing)
- **Deployment**: GitHub Pages (requires service worker for COOP/COEP headers)

## Architecture

### Serverless P2P Approach
- **Trystero** handles peer discovery via public BitTorrent trackers (no custom server)
- Session ID encoded in shareable URL: `https://app.com/session/{uuid}`
- WebRTC mesh topology - each peer connects directly to all others
- Public STUN servers for NAT traversal

### Key Data Flows
```
1. Host creates session → Trystero joins room → generates shareable link
2. Guest opens link → Trystero joins same room → peers exchange SDP → direct P2P connection
3. Recording: Host triggers → all peers start local MediaRecorder → "On Air" shown
4. Transfer: Recording stops → each peer sends HQ files to host via DataChannel
5. Composite: Host uses FFmpeg.wasm to splice videos based on edit points → download
```

## Project Structure
```
src/
├── components/
│   ├── layout/          # MainLayout, Header, Sidebar
│   ├── video/           # MainDisplay, UserTile, TileGrid, ScreenShareBadge
│   ├── recording/       # RecordButton, CountdownOverlay, OnAirIndicator, TransferProgress
│   ├── connection/      # JoinSession, CreateSession, ShareLink, ConnectionHistory
│   └── compositing/     # CompositeEditor, CompositeProgress, DownloadButton
├── services/
│   ├── p2p/             # SignalingService, PeerManager, DataChannelManager
│   ├── recording/       # RecordingCoordinator, LocalRecorder
│   ├── transfer/        # FileTransferProtocol, TransferQueue
│   └── compositing/     # FFmpegService, TimelineBuilder
├── store/               # Zustand stores (session, peers, recording, transfer, editPoints)
├── hooks/               # useWebRTC, useMediaStream, useRecording, useFileTransfer
└── types/               # TypeScript interfaces
```

## Implementation Phases

See individual phase files for detailed implementation plans:
- [Phase 1: Core P2P Infrastructure](./phase-1-p2p-infrastructure.md)
- [Phase 2: Screen Sharing & Focus](./phase-2-screen-sharing.md)
- [Phase 3: Recording System](./phase-3-recording.md)
- [Phase 4: File Transfer](./phase-4-file-transfer.md)
- [Phase 5: Video Compositing](./phase-5-compositing.md)
- [Phase 6: Polish](./phase-6-polish.md)

## Verification Plan
1. **P2P Connection**: Open app in 2+ browser tabs/devices, verify video streams
2. **Screen Share**: Start screen share, verify badge appears, change focus
3. **Recording**: Start recording, verify countdown and On-Air on all peers
4. **Transfer**: Stop recording, verify progress bars, wait for completion
5. **Compositing**: Trigger composite, verify progress, download final video
6. **Edge Cases**: Test browser close warning, reconnection, large files

## Risks & Mitigations
| Risk | Mitigation |
|------|------------|
| Tracker unreliability | Multiple trackers + Nostr fallback |
| Large file transfer failure | Resumable transfers via IndexedDB checkpointing |
| FFmpeg memory limits | Process in segments, clear feedback on limits |
| NAT traversal failure | Multiple STUN servers, clear error messaging |
