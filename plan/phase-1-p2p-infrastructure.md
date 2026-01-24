# Phase 1: Core P2P Infrastructure

## Tasks
- [ ] Project setup (Vite, React, TypeScript, Tailwind)
- [ ] SignalingService with Trystero
- [ ] PeerManager for WebRTC connections
- [ ] Session create/join flows with shareable links
- [ ] Video stream sharing between peers
- [ ] Basic UI layout (MainDisplay + TileGrid)
- [ ] Connection history in localStorage

## Project Setup

### Initialize Project
```bash
npm create vite@latest . -- --template react-ts
npm install
```

### Install Dependencies
```bash
# Core
npm install react-router-dom zustand

# P2P
npm install trystero

# Styling
npm install -D tailwindcss postcss autoprefixer
npx tailwindcss init -p

# Utilities
npm install uuid
npm install -D @types/uuid
```

### Tailwind Configuration
```typescript
// tailwind.config.js
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: '#6366f1',
        secondary: '#22d3ee',
        dark: '#0f172a',
        'dark-lighter': '#1e293b'
      }
    }
  },
  plugins: []
};
```

### Vite Configuration
```typescript
// vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp'
    }
  }
});
```

## Trystero Configuration

```typescript
// src/services/p2p/config.ts
export const P2P_CONFIG = {
  appId: 'vdo-samurai-v1',
  trackerUrls: [
    'wss://tracker.openwebtorrent.com',
    'wss://tracker.btorrent.xyz',
    'wss://tracker.fastcast.nz'
  ]
};

export const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' }
  ]
};
```

## SignalingService

```typescript
// src/services/p2p/SignalingService.ts
import { joinRoom, Room } from 'trystero/torrent';
import { P2P_CONFIG, RTC_CONFIG } from './config';

export class SignalingService {
  private room: Room | null = null;

  async joinSession(sessionId: string): Promise<Room> {
    this.room = joinRoom(
      { appId: P2P_CONFIG.appId, trackerUrls: P2P_CONFIG.trackerUrls },
      sessionId,
      RTC_CONFIG
    );
    return this.room;
  }

  leaveSession(): void {
    this.room?.leave();
    this.room = null;
  }

  getRoom(): Room | null {
    return this.room;
  }
}
```

## PeerManager

```typescript
// src/services/p2p/PeerManager.ts
import { Room } from 'trystero/torrent';

export interface Peer {
  id: string;
  stream: MediaStream | null;
  screenStream: MediaStream | null;
  name: string;
  isHost: boolean;
}

export class PeerManager {
  private peers: Map<string, Peer> = new Map();
  private room: Room | null = null;

  initialize(room: Room): void {
    this.room = room;

    room.onPeerJoin(peerId => {
      this.peers.set(peerId, {
        id: peerId,
        stream: null,
        screenStream: null,
        name: `User-${peerId.slice(0, 4)}`,
        isHost: false
      });
    });

    room.onPeerLeave(peerId => {
      this.peers.delete(peerId);
    });

    room.onPeerStream((stream, peerId) => {
      const peer = this.peers.get(peerId);
      if (peer) {
        // Determine if this is a screen share or camera stream
        if (stream.getVideoTracks()[0]?.label.includes('screen')) {
          peer.screenStream = stream;
        } else {
          peer.stream = stream;
        }
      }
    });
  }

  addLocalStream(stream: MediaStream): void {
    this.room?.addStream(stream);
  }

  removeLocalStream(stream: MediaStream): void {
    this.room?.removeStream(stream);
  }

  getPeers(): Peer[] {
    return Array.from(this.peers.values());
  }
}
```

## Zustand Store

```typescript
// src/store/sessionStore.ts
import { create } from 'zustand';

interface SessionState {
  sessionId: string | null;
  isHost: boolean;
  localStream: MediaStream | null;
  localScreenStream: MediaStream | null;
  focusedPeerId: string | null;

  setSessionId: (id: string | null) => void;
  setIsHost: (isHost: boolean) => void;
  setLocalStream: (stream: MediaStream | null) => void;
  setLocalScreenStream: (stream: MediaStream | null) => void;
  setFocusedPeerId: (peerId: string | null) => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  sessionId: null,
  isHost: false,
  localStream: null,
  localScreenStream: null,
  focusedPeerId: null,

  setSessionId: (id) => set({ sessionId: id }),
  setIsHost: (isHost) => set({ isHost }),
  setLocalStream: (stream) => set({ localStream: stream }),
  setLocalScreenStream: (stream) => set({ localScreenStream: stream }),
  setFocusedPeerId: (peerId) => set({ focusedPeerId: peerId })
}));
```

```typescript
// src/store/peerStore.ts
import { create } from 'zustand';
import { Peer } from '../services/p2p/PeerManager';

interface PeerState {
  peers: Peer[];
  setPeers: (peers: Peer[]) => void;
  updatePeer: (peerId: string, updates: Partial<Peer>) => void;
  removePeer: (peerId: string) => void;
}

export const usePeerStore = create<PeerState>((set) => ({
  peers: [],
  setPeers: (peers) => set({ peers }),
  updatePeer: (peerId, updates) => set((state) => ({
    peers: state.peers.map(p => p.id === peerId ? { ...p, ...updates } : p)
  })),
  removePeer: (peerId) => set((state) => ({
    peers: state.peers.filter(p => p.id !== peerId)
  }))
}));
```

## Connection History

```typescript
// src/services/storage/connectionHistory.ts
const STORAGE_KEY = 'vdo-samurai-connections';

interface ConnectionRecord {
  sessionId: string;
  name: string;
  timestamp: number;
  isHost: boolean;
}

export function saveConnection(record: ConnectionRecord): void {
  const history = getConnectionHistory();
  const filtered = history.filter(r => r.sessionId !== record.sessionId);
  filtered.unshift(record);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered.slice(0, 10)));
}

export function getConnectionHistory(): ConnectionRecord[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  } catch {
    return [];
  }
}

export function clearConnectionHistory(): void {
  localStorage.removeItem(STORAGE_KEY);
}
```

## UI Components

### MainLayout
```typescript
// src/components/layout/MainLayout.tsx
export function MainLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-dark text-white">
      <Header />
      <main className="container mx-auto p-4">
        {children}
      </main>
    </div>
  );
}
```

### Header
```typescript
// src/components/layout/Header.tsx
export function Header() {
  const { sessionId } = useSessionStore();

  return (
    <header className="bg-dark-lighter border-b border-gray-700 p-4">
      <div className="container mx-auto flex items-center justify-between">
        <h1 className="text-xl font-bold text-primary">VDO Samurai</h1>
        {sessionId && <ShareLink sessionId={sessionId} />}
      </div>
    </header>
  );
}
```

### MainDisplay
```typescript
// src/components/video/MainDisplay.tsx
export function MainDisplay() {
  const { focusedPeerId, localStream } = useSessionStore();
  const { peers } = usePeerStore();

  const focusedPeer = peers.find(p => p.id === focusedPeerId);
  const stream = focusedPeer?.stream || localStream;

  return (
    <div className="aspect-video bg-dark-lighter rounded-lg overflow-hidden">
      {stream ? (
        <video
          autoPlay
          playsInline
          muted={!focusedPeer}
          ref={el => { if (el) el.srcObject = stream; }}
          className="w-full h-full object-cover"
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-gray-500">
          No video
        </div>
      )}
    </div>
  );
}
```

### TileGrid
```typescript
// src/components/video/TileGrid.tsx
export function TileGrid() {
  const { peers } = usePeerStore();
  const { localStream, focusedPeerId, setFocusedPeerId } = useSessionStore();

  return (
    <div className="grid grid-cols-4 gap-2 mt-4">
      <UserTile
        stream={localStream}
        name="You"
        isFocused={focusedPeerId === null}
        onClick={() => setFocusedPeerId(null)}
        muted
      />
      {peers.map(peer => (
        <UserTile
          key={peer.id}
          stream={peer.stream}
          name={peer.name}
          isFocused={focusedPeerId === peer.id}
          onClick={() => setFocusedPeerId(peer.id)}
        />
      ))}
    </div>
  );
}
```

### UserTile
```typescript
// src/components/video/UserTile.tsx
interface UserTileProps {
  stream: MediaStream | null;
  name: string;
  isFocused: boolean;
  onClick: () => void;
  muted?: boolean;
}

export function UserTile({ stream, name, isFocused, onClick, muted }: UserTileProps) {
  return (
    <div
      onClick={onClick}
      className={`
        aspect-video bg-dark-lighter rounded-lg overflow-hidden cursor-pointer
        border-2 transition-colors
        ${isFocused ? 'border-primary' : 'border-transparent hover:border-gray-600'}
      `}
    >
      {stream ? (
        <video
          autoPlay
          playsInline
          muted={muted}
          ref={el => { if (el) el.srcObject = stream; }}
          className="w-full h-full object-cover"
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-gray-500 text-sm">
          {name}
        </div>
      )}
      <div className="absolute bottom-1 left-1 text-xs bg-black/50 px-1 rounded">
        {name}
      </div>
    </div>
  );
}
```

## Routing

```typescript
// src/App.tsx
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { MainLayout } from './components/layout/MainLayout';
import { HomePage } from './pages/HomePage';
import { SessionPage } from './pages/SessionPage';

export function App() {
  return (
    <BrowserRouter>
      <MainLayout>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/session/:sessionId" element={<SessionPage />} />
        </Routes>
      </MainLayout>
    </BrowserRouter>
  );
}
```

## Files to Create

1. `src/services/p2p/config.ts`
2. `src/services/p2p/SignalingService.ts`
3. `src/services/p2p/PeerManager.ts`
4. `src/services/p2p/index.ts`
5. `src/services/storage/connectionHistory.ts`
6. `src/store/sessionStore.ts`
7. `src/store/peerStore.ts`
8. `src/components/layout/MainLayout.tsx`
9. `src/components/layout/Header.tsx`
10. `src/components/video/MainDisplay.tsx`
11. `src/components/video/TileGrid.tsx`
12. `src/components/video/UserTile.tsx`
13. `src/components/connection/CreateSession.tsx`
14. `src/components/connection/JoinSession.tsx`
15. `src/components/connection/ShareLink.tsx`
16. `src/components/connection/ConnectionHistory.tsx`
17. `src/pages/HomePage.tsx`
18. `src/pages/SessionPage.tsx`
19. `src/hooks/useWebRTC.ts`
20. `src/hooks/useMediaStream.ts`
21. `src/types/index.ts`
