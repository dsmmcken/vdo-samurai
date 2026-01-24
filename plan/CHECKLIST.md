# VDO Samurai Implementation Checklist

## Quick Start Commands

```bash
# Initialize project
npm create vite@latest . -- --template react-ts
npm install

# Core dependencies
npm install react-router-dom zustand trystero uuid
npm install -D @types/uuid

# Styling
npm install -D tailwindcss postcss autoprefixer
npx tailwindcss init -p

# FFmpeg (Phase 5)
npm install @ffmpeg/ffmpeg @ffmpeg/util
```

---

## Phase 1: Core P2P Infrastructure
- [ ] Project setup (Vite, React, TypeScript, Tailwind)
- [ ] Configure Vite with COOP/COEP headers
- [ ] Create TypeScript types (`src/types/index.ts`)
- [ ] SignalingService with Trystero
- [ ] PeerManager for WebRTC connections
- [ ] Session store (Zustand)
- [ ] Peer store (Zustand)
- [ ] Session create/join flows with shareable links
- [ ] Video stream sharing between peers
- [ ] Basic UI layout (MainLayout, Header)
- [ ] MainDisplay component
- [ ] TileGrid + UserTile components
- [ ] CreateSession + JoinSession components
- [ ] ShareLink component
- [ ] ConnectionHistory in localStorage
- [ ] React Router setup
- [ ] HomePage + SessionPage

## Phase 2: Screen Sharing & Focus
- [ ] ScreenCaptureService
- [ ] useScreenShare hook
- [ ] ScreenShareButton component
- [ ] ScreenShareBadge component
- [ ] FocusService for P2P focus messaging
- [ ] useFocus hook
- [ ] Update UserTile with screen share support
- [ ] Update MainDisplay for focus changes

## Phase 3: Recording System
- [ ] Recording config (codec detection)
- [ ] LocalRecorder service
- [ ] IndexedDB storage for recordings
- [ ] RecordingCoordinator for synchronized start/stop
- [ ] Recording store (Zustand)
- [ ] useRecording hook
- [ ] RecordButton component (host only)
- [ ] CountdownOverlay component
- [ ] OnAirIndicator component
- [ ] useEditPoints hook for edit point logging

## Phase 4: File Transfer
- [ ] Transfer config (chunk sizes, watermarks)
- [ ] FileTransferProtocol with chunking
- [ ] TransferQueue for parallel transfers
- [ ] Transfer store (Zustand)
- [ ] useFileTransfer hook
- [ ] TransferProgress component
- [ ] SHA-256 hash verification
- [ ] beforeunload warning during transfer

## Phase 5: Video Compositing
- [ ] Download coi-serviceworker.js to public/
- [ ] Update index.html with service worker registration
- [ ] FFmpegService
- [ ] TimelineBuilder
- [ ] CompositeService with chunked processing
- [ ] Composite store (Zustand)
- [ ] useComposite hook
- [ ] CompositeEditor component
- [ ] CompositeProgress component
- [ ] DownloadButton component

## Phase 6: Polish
- [ ] Error types and messages
- [ ] Error store (Zustand)
- [ ] ErrorToast component
- [ ] ReconnectionManager
- [ ] QualityAdapter for video quality
- [ ] Lazy loading for FFmpeg
- [ ] useFocusTrap hook
- [ ] useMediaQuery hook
- [ ] ScreenReaderAnnounce component
- [ ] MobileControls component
- [ ] Responsive TileGrid
- [ ] Update CSS with utility classes

---

## File Structure Summary

```
src/
├── components/
│   ├── layout/
│   │   ├── MainLayout.tsx
│   │   ├── Header.tsx
│   │   └── MobileControls.tsx
│   ├── video/
│   │   ├── MainDisplay.tsx
│   │   ├── UserTile.tsx
│   │   ├── TileGrid.tsx
│   │   ├── ScreenShareBadge.tsx
│   │   └── ScreenShareButton.tsx
│   ├── recording/
│   │   ├── RecordButton.tsx
│   │   ├── CountdownOverlay.tsx
│   │   ├── OnAirIndicator.tsx
│   │   └── TransferProgress.tsx
│   ├── connection/
│   │   ├── CreateSession.tsx
│   │   ├── JoinSession.tsx
│   │   ├── ShareLink.tsx
│   │   └── ConnectionHistory.tsx
│   ├── compositing/
│   │   ├── CompositeEditor.tsx
│   │   ├── CompositeProgress.tsx
│   │   └── DownloadButton.tsx
│   └── ui/
│       ├── ErrorToast.tsx
│       └── ScreenReaderAnnounce.tsx
├── services/
│   ├── p2p/
│   │   ├── config.ts
│   │   ├── SignalingService.ts
│   │   ├── PeerManager.ts
│   │   ├── FocusService.ts
│   │   ├── ReconnectionManager.ts
│   │   └── index.ts
│   ├── media/
│   │   ├── ScreenCaptureService.ts
│   │   └── QualityAdapter.ts
│   ├── recording/
│   │   ├── config.ts
│   │   ├── LocalRecorder.ts
│   │   └── RecordingCoordinator.ts
│   ├── transfer/
│   │   ├── config.ts
│   │   ├── FileTransferProtocol.ts
│   │   └── TransferQueue.ts
│   ├── compositing/
│   │   ├── FFmpegService.ts
│   │   ├── TimelineBuilder.ts
│   │   ├── CompositeService.ts
│   │   └── LazyFFmpeg.ts
│   └── storage/
│       ├── connectionHistory.ts
│       └── recordingStorage.ts
├── store/
│   ├── sessionStore.ts
│   ├── peerStore.ts
│   ├── recordingStore.ts
│   ├── transferStore.ts
│   ├── compositeStore.ts
│   └── errorStore.ts
├── hooks/
│   ├── useWebRTC.ts
│   ├── useMediaStream.ts
│   ├── useScreenShare.ts
│   ├── useFocus.ts
│   ├── useRecording.ts
│   ├── useEditPoints.ts
│   ├── useFileTransfer.ts
│   ├── useComposite.ts
│   ├── useFocusTrap.ts
│   └── useMediaQuery.ts
├── pages/
│   ├── HomePage.tsx
│   └── SessionPage.tsx
├── types/
│   ├── index.ts
│   ├── messages.ts
│   └── errors.ts
├── App.tsx
├── main.tsx
└── index.css
```

---

## Verification Tests

### Phase 1: P2P Connection
1. Open app in 2 browser tabs
2. Create session in Tab 1
3. Copy shareable link
4. Open link in Tab 2
5. Verify video streams appear in both tabs

### Phase 2: Screen Sharing
1. Click "Share Screen" in one tab
2. Verify screen appears in other tab
3. Verify ScreenShareBadge shows
4. Click tile to change focus
5. Verify focus changes in both tabs

### Phase 3: Recording
1. Host clicks "Start Recording"
2. Verify countdown appears in all tabs
3. Verify "On Air" indicator appears
4. Record for 30+ seconds
5. Host clicks "Stop Recording"
6. Verify recording saved locally

### Phase 4: File Transfer
1. After recording stops, transfers should start automatically
2. Verify progress bars appear
3. Try to close browser - verify warning
4. Wait for transfers to complete
5. Verify hash verification passes

### Phase 5: Compositing
1. After all transfers complete, open Composite Editor
2. Verify timeline shows edit points
3. Select output format
4. Click "Create Composite"
5. Verify progress updates
6. Download final video
7. Verify video plays correctly

### Phase 6: Polish
1. Test on mobile device
2. Verify responsive layout
3. Test keyboard navigation
4. Test with screen reader
5. Disconnect peer and verify reconnection
6. Test error states
