# Phase 2: Screen Sharing & Focus

## Tasks
- [ ] Screen capture via getDisplayMedia
- [ ] Add screen streams to peer connections
- [ ] ScreenShareBadge indicators
- [ ] Focus management (who is main display)
- [ ] P2P messaging for focus changes
- [ ] Any user can change global focus

## Screen Capture Service

```typescript
// src/services/media/ScreenCaptureService.ts
export class ScreenCaptureService {
  private screenStream: MediaStream | null = null;

  async startScreenShare(): Promise<MediaStream> {
    this.screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        frameRate: { ideal: 30 }
      },
      audio: true
    });

    // Handle user stopping share via browser UI
    this.screenStream.getVideoTracks()[0].addEventListener('ended', () => {
      this.stopScreenShare();
    });

    return this.screenStream;
  }

  stopScreenShare(): void {
    if (this.screenStream) {
      this.screenStream.getTracks().forEach(track => track.stop());
      this.screenStream = null;
    }
  }

  getScreenStream(): MediaStream | null {
    return this.screenStream;
  }

  isSharing(): boolean {
    return this.screenStream !== null;
  }
}
```

## Screen Share Hook

```typescript
// src/hooks/useScreenShare.ts
import { useState, useCallback, useRef } from 'react';
import { useSessionStore } from '../store/sessionStore';
import { ScreenCaptureService } from '../services/media/ScreenCaptureService';

export function useScreenShare() {
  const [isSharing, setIsSharing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const serviceRef = useRef(new ScreenCaptureService());
  const { setLocalScreenStream } = useSessionStore();

  const startSharing = useCallback(async () => {
    try {
      setError(null);
      const stream = await serviceRef.current.startScreenShare();
      setLocalScreenStream(stream);
      setIsSharing(true);

      // Listen for track ended
      stream.getVideoTracks()[0].addEventListener('ended', () => {
        setLocalScreenStream(null);
        setIsSharing(false);
      });

      return stream;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to share screen';
      setError(message);
      throw err;
    }
  }, [setLocalScreenStream]);

  const stopSharing = useCallback(() => {
    serviceRef.current.stopScreenShare();
    setLocalScreenStream(null);
    setIsSharing(false);
  }, [setLocalScreenStream]);

  return { isSharing, startSharing, stopSharing, error };
}
```

## Focus Management Protocol

### Message Types
```typescript
// src/types/messages.ts
export interface FocusChangeMessage {
  type: 'focus-change';
  peerId: string | null; // null = local/self, string = remote peer
  timestamp: number;
}

export interface ScreenShareStatusMessage {
  type: 'screen-share-status';
  isSharing: boolean;
  peerId: string;
}
```

### Focus Service
```typescript
// src/services/p2p/FocusService.ts
import { Room } from 'trystero/torrent';
import { useSessionStore } from '../../store/sessionStore';

export class FocusService {
  private room: Room | null = null;
  private sendFocusChange: ((data: any) => void) | null = null;
  private onFocusChange: ((callback: (data: any, peerId: string) => void) => void) | null = null;

  initialize(room: Room): void {
    this.room = room;

    const [sendFocus, onFocus] = room.makeAction('focus-change');
    this.sendFocusChange = sendFocus;
    this.onFocusChange = onFocus;

    // Listen for focus changes from other peers
    onFocus((data, peerId) => {
      useSessionStore.getState().setFocusedPeerId(data.peerId);
    });
  }

  broadcastFocusChange(peerId: string | null): void {
    if (this.sendFocusChange) {
      this.sendFocusChange({ peerId, timestamp: Date.now() });
    }
    // Also update local state
    useSessionStore.getState().setFocusedPeerId(peerId);
  }
}
```

## ScreenShareBadge Component

```typescript
// src/components/video/ScreenShareBadge.tsx
interface ScreenShareBadgeProps {
  isSharing: boolean;
}

export function ScreenShareBadge({ isSharing }: ScreenShareBadgeProps) {
  if (!isSharing) return null;

  return (
    <div className="absolute top-2 left-2 flex items-center gap-1 bg-green-500/90 text-white text-xs px-2 py-1 rounded-full">
      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
        <path d="M3 4a1 1 0 011-1h12a1 1 0 011 1v8a1 1 0 01-1 1H4a1 1 0 01-1-1V4zm1 0v8h12V4H4z"/>
        <path d="M8 14h4v2H8v-2z"/>
        <path d="M6 18h8v1H6v-1z"/>
      </svg>
      <span>Screen</span>
    </div>
  );
}
```

## Screen Share Button

```typescript
// src/components/video/ScreenShareButton.tsx
import { useScreenShare } from '../../hooks/useScreenShare';

export function ScreenShareButton() {
  const { isSharing, startSharing, stopSharing, error } = useScreenShare();

  return (
    <div>
      <button
        onClick={isSharing ? stopSharing : startSharing}
        className={`
          px-4 py-2 rounded-lg font-medium transition-colors
          ${isSharing
            ? 'bg-red-500 hover:bg-red-600 text-white'
            : 'bg-primary hover:bg-primary/80 text-white'
          }
        `}
      >
        {isSharing ? 'Stop Sharing' : 'Share Screen'}
      </button>
      {error && (
        <p className="text-red-400 text-sm mt-1">{error}</p>
      )}
    </div>
  );
}
```

## Updated UserTile with Screen Share Badge

```typescript
// src/components/video/UserTile.tsx
import { ScreenShareBadge } from './ScreenShareBadge';

interface UserTileProps {
  stream: MediaStream | null;
  screenStream: MediaStream | null;
  name: string;
  isFocused: boolean;
  onClick: () => void;
  muted?: boolean;
}

export function UserTile({
  stream,
  screenStream,
  name,
  isFocused,
  onClick,
  muted
}: UserTileProps) {
  // Show screen stream if available, otherwise camera stream
  const displayStream = screenStream || stream;
  const isSharing = screenStream !== null;

  return (
    <div
      onClick={onClick}
      className={`
        relative aspect-video bg-dark-lighter rounded-lg overflow-hidden cursor-pointer
        border-2 transition-colors
        ${isFocused ? 'border-primary' : 'border-transparent hover:border-gray-600'}
      `}
    >
      {displayStream ? (
        <video
          autoPlay
          playsInline
          muted={muted}
          ref={el => { if (el) el.srcObject = displayStream; }}
          className="w-full h-full object-cover"
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-gray-500 text-sm">
          {name}
        </div>
      )}
      <ScreenShareBadge isSharing={isSharing} />
      <div className="absolute bottom-1 left-1 text-xs bg-black/50 px-1 rounded">
        {name}
      </div>
    </div>
  );
}
```

## Focus Management in TileGrid

```typescript
// src/components/video/TileGrid.tsx
import { useFocus } from '../../hooks/useFocus';

export function TileGrid() {
  const { peers } = usePeerStore();
  const { localStream, localScreenStream, focusedPeerId } = useSessionStore();
  const { changeFocus } = useFocus();

  return (
    <div className="grid grid-cols-4 gap-2 mt-4">
      <UserTile
        stream={localStream}
        screenStream={localScreenStream}
        name="You"
        isFocused={focusedPeerId === null}
        onClick={() => changeFocus(null)}
        muted
      />
      {peers.map(peer => (
        <UserTile
          key={peer.id}
          stream={peer.stream}
          screenStream={peer.screenStream}
          name={peer.name}
          isFocused={focusedPeerId === peer.id}
          onClick={() => changeFocus(peer.id)}
        />
      ))}
    </div>
  );
}
```

## useFocus Hook

```typescript
// src/hooks/useFocus.ts
import { useCallback, useRef, useEffect } from 'react';
import { useSessionStore } from '../store/sessionStore';
import { FocusService } from '../services/p2p/FocusService';

export function useFocus(room?: Room) {
  const serviceRef = useRef(new FocusService());
  const { focusedPeerId, setFocusedPeerId } = useSessionStore();

  useEffect(() => {
    if (room) {
      serviceRef.current.initialize(room);
    }
  }, [room]);

  const changeFocus = useCallback((peerId: string | null) => {
    serviceRef.current.broadcastFocusChange(peerId);
  }, []);

  return { focusedPeerId, changeFocus };
}
```

## Files to Create/Modify

1. `src/services/media/ScreenCaptureService.ts`
2. `src/services/p2p/FocusService.ts`
3. `src/hooks/useScreenShare.ts`
4. `src/hooks/useFocus.ts`
5. `src/components/video/ScreenShareBadge.tsx`
6. `src/components/video/ScreenShareButton.tsx`
7. `src/types/messages.ts`
8. Update `src/components/video/UserTile.tsx`
9. Update `src/components/video/TileGrid.tsx`
10. Update `src/components/video/MainDisplay.tsx`
