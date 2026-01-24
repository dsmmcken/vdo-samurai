# Phase 6: Polish

## Tasks
- [ ] Error handling & reconnection logic
- [ ] Performance optimization
- [ ] Accessibility improvements
- [ ] Mobile responsiveness

## Error Handling

### Connection Error Types

```typescript
// src/types/errors.ts
export enum ConnectionErrorType {
  TRACKER_UNAVAILABLE = 'TRACKER_UNAVAILABLE',
  PEER_CONNECTION_FAILED = 'PEER_CONNECTION_FAILED',
  MEDIA_ACCESS_DENIED = 'MEDIA_ACCESS_DENIED',
  ICE_FAILURE = 'ICE_FAILURE',
  SIGNALING_TIMEOUT = 'SIGNALING_TIMEOUT'
}

export interface ConnectionError {
  type: ConnectionErrorType;
  message: string;
  recoverable: boolean;
  suggestion: string;
}

export const ERROR_MESSAGES: Record<ConnectionErrorType, ConnectionError> = {
  [ConnectionErrorType.TRACKER_UNAVAILABLE]: {
    type: ConnectionErrorType.TRACKER_UNAVAILABLE,
    message: 'Unable to connect to signaling servers',
    recoverable: true,
    suggestion: 'Check your internet connection and try again'
  },
  [ConnectionErrorType.PEER_CONNECTION_FAILED]: {
    type: ConnectionErrorType.PEER_CONNECTION_FAILED,
    message: 'Failed to establish peer connection',
    recoverable: true,
    suggestion: 'The other participant may be behind a restrictive firewall'
  },
  [ConnectionErrorType.MEDIA_ACCESS_DENIED]: {
    type: ConnectionErrorType.MEDIA_ACCESS_DENIED,
    message: 'Camera/microphone access denied',
    recoverable: false,
    suggestion: 'Please allow camera and microphone access in your browser settings'
  },
  [ConnectionErrorType.ICE_FAILURE]: {
    type: ConnectionErrorType.ICE_FAILURE,
    message: 'Network connection could not be established',
    recoverable: true,
    suggestion: 'Try refreshing the page or using a different network'
  },
  [ConnectionErrorType.SIGNALING_TIMEOUT]: {
    type: ConnectionErrorType.SIGNALING_TIMEOUT,
    message: 'Connection timed out',
    recoverable: true,
    suggestion: 'Make sure the session link is correct and the host is online'
  }
};
```

### Error Store

```typescript
// src/store/errorStore.ts
import { create } from 'zustand';
import { ConnectionError } from '../types/errors';

interface ErrorState {
  errors: ConnectionError[];
  addError: (error: ConnectionError) => void;
  removeError: (type: string) => void;
  clearErrors: () => void;
}

export const useErrorStore = create<ErrorState>((set) => ({
  errors: [],
  addError: (error) => set((state) => ({
    errors: [...state.errors.filter(e => e.type !== error.type), error]
  })),
  removeError: (type) => set((state) => ({
    errors: state.errors.filter(e => e.type !== type)
  })),
  clearErrors: () => set({ errors: [] })
}));
```

### Error Toast Component

```typescript
// src/components/ui/ErrorToast.tsx
import { useErrorStore } from '../../store/errorStore';

export function ErrorToast() {
  const { errors, removeError } = useErrorStore();

  if (errors.length === 0) return null;

  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 space-y-2 w-full max-w-md px-4">
      {errors.map((error) => (
        <div
          key={error.type}
          className="bg-red-500/90 text-white rounded-lg p-4 shadow-lg"
          role="alert"
        >
          <div className="flex items-start justify-between">
            <div>
              <p className="font-medium">{error.message}</p>
              <p className="text-sm text-red-100 mt-1">{error.suggestion}</p>
            </div>
            <button
              onClick={() => removeError(error.type)}
              className="text-red-100 hover:text-white ml-4"
              aria-label="Dismiss error"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {error.recoverable && (
            <button
              onClick={() => {
                removeError(error.type);
                window.location.reload();
              }}
              className="mt-3 text-sm bg-white/20 hover:bg-white/30 px-3 py-1 rounded"
            >
              Try Again
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
```

## Reconnection Logic

```typescript
// src/services/p2p/ReconnectionManager.ts
import { useSessionStore } from '../../store/sessionStore';
import { usePeerStore } from '../../store/peerStore';

export class ReconnectionManager {
  private reconnectAttempts: Map<string, number> = new Map();
  private maxAttempts = 3;
  private reconnectDelay = 2000;

  async handlePeerDisconnect(peerId: string, reconnectFn: () => Promise<void>): Promise<boolean> {
    const attempts = this.reconnectAttempts.get(peerId) || 0;

    if (attempts >= this.maxAttempts) {
      this.reconnectAttempts.delete(peerId);
      return false;
    }

    this.reconnectAttempts.set(peerId, attempts + 1);

    await new Promise(resolve => setTimeout(resolve, this.reconnectDelay * (attempts + 1)));

    try {
      await reconnectFn();
      this.reconnectAttempts.delete(peerId);
      return true;
    } catch {
      return this.handlePeerDisconnect(peerId, reconnectFn);
    }
  }

  reset(peerId: string): void {
    this.reconnectAttempts.delete(peerId);
  }
}
```

## Performance Optimization

### Video Quality Adaptation

```typescript
// src/services/media/QualityAdapter.ts
export class QualityAdapter {
  private highQualityConstraints: MediaTrackConstraints = {
    width: { ideal: 1920 },
    height: { ideal: 1080 },
    frameRate: { ideal: 30 }
  };

  private lowQualityConstraints: MediaTrackConstraints = {
    width: { ideal: 640 },
    height: { ideal: 360 },
    frameRate: { ideal: 15 }
  };

  async adaptQuality(
    stream: MediaStream,
    peerCount: number
  ): Promise<void> {
    const videoTrack = stream.getVideoTracks()[0];
    if (!videoTrack) return;

    // Reduce quality when many peers connected
    const constraints = peerCount > 4
      ? this.lowQualityConstraints
      : this.highQualityConstraints;

    try {
      await videoTrack.applyConstraints(constraints);
    } catch (err) {
      console.warn('Could not apply video constraints:', err);
    }
  }
}
```

### Lazy Loading FFmpeg

```typescript
// src/services/compositing/LazyFFmpeg.ts
let ffmpegPromise: Promise<CompositeService> | null = null;

export async function getFFmpegService(): Promise<CompositeService> {
  if (!ffmpegPromise) {
    ffmpegPromise = import('./CompositeService').then(async (module) => {
      const service = new module.CompositeService();
      await service.initialize();
      return service;
    });
  }
  return ffmpegPromise;
}
```

## Accessibility Improvements

### Focus Management

```typescript
// src/hooks/useFocusTrap.ts
import { useEffect, useRef } from 'react';

export function useFocusTrap(isActive: boolean) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isActive || !containerRef.current) return;

    const focusableElements = containerRef.current.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );

    const firstElement = focusableElements[0] as HTMLElement;
    const lastElement = focusableElements[focusableElements.length - 1] as HTMLElement;

    firstElement?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;

      if (e.shiftKey) {
        if (document.activeElement === firstElement) {
          e.preventDefault();
          lastElement?.focus();
        }
      } else {
        if (document.activeElement === lastElement) {
          e.preventDefault();
          firstElement?.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isActive]);

  return containerRef;
}
```

### Screen Reader Announcements

```typescript
// src/components/ui/ScreenReaderAnnounce.tsx
import { useEffect, useState } from 'react';

interface Props {
  message: string;
  assertive?: boolean;
}

export function ScreenReaderAnnounce({ message, assertive = false }: Props) {
  const [announcement, setAnnouncement] = useState('');

  useEffect(() => {
    setAnnouncement(message);
    const timer = setTimeout(() => setAnnouncement(''), 1000);
    return () => clearTimeout(timer);
  }, [message]);

  return (
    <div
      role="status"
      aria-live={assertive ? 'assertive' : 'polite'}
      aria-atomic="true"
      className="sr-only"
    >
      {announcement}
    </div>
  );
}
```

### Keyboard Navigation

```typescript
// src/components/video/TileGrid.tsx - with keyboard support
export function TileGrid() {
  const { peers } = usePeerStore();
  const { localStream, focusedPeerId } = useSessionStore();
  const { changeFocus } = useFocus();

  const allParticipants = [
    { id: null, stream: localStream, name: 'You' },
    ...peers.map(p => ({ id: p.id, stream: p.stream, name: p.name }))
  ];

  const handleKeyDown = (e: React.KeyboardEvent, index: number) => {
    let newIndex = index;

    switch (e.key) {
      case 'ArrowRight':
        newIndex = (index + 1) % allParticipants.length;
        break;
      case 'ArrowLeft':
        newIndex = (index - 1 + allParticipants.length) % allParticipants.length;
        break;
      case 'Enter':
      case ' ':
        changeFocus(allParticipants[index].id);
        return;
      default:
        return;
    }

    e.preventDefault();
    const tiles = document.querySelectorAll('[data-tile-index]');
    (tiles[newIndex] as HTMLElement)?.focus();
  };

  return (
    <div
      className="grid grid-cols-4 gap-2 mt-4"
      role="listbox"
      aria-label="Video participants"
    >
      {allParticipants.map((participant, index) => (
        <UserTile
          key={participant.id ?? 'local'}
          stream={participant.stream}
          name={participant.name}
          isFocused={focusedPeerId === participant.id}
          onClick={() => changeFocus(participant.id)}
          onKeyDown={(e) => handleKeyDown(e, index)}
          tabIndex={0}
          data-tile-index={index}
          role="option"
          aria-selected={focusedPeerId === participant.id}
        />
      ))}
    </div>
  );
}
```

## Mobile Responsiveness

### Responsive Layout

```typescript
// src/components/layout/MainLayout.tsx
export function MainLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-dark text-white flex flex-col">
      <Header />
      <main className="flex-1 container mx-auto p-2 md:p-4">
        {children}
      </main>
      <MobileControls />
    </div>
  );
}
```

### Mobile Controls

```typescript
// src/components/layout/MobileControls.tsx
import { useMediaQuery } from '../../hooks/useMediaQuery';

export function MobileControls() {
  const isMobile = useMediaQuery('(max-width: 768px)');
  const { isRecording } = useRecordingStore();
  const { isSharing, startSharing, stopSharing } = useScreenShare();

  if (!isMobile) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-dark-lighter border-t border-gray-700 p-4 safe-area-pb">
      <div className="flex justify-center gap-4">
        <button
          onClick={isSharing ? stopSharing : startSharing}
          className="p-4 rounded-full bg-gray-700"
          aria-label={isSharing ? 'Stop sharing screen' : 'Share screen'}
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
        </button>

        <RecordButton />

        <button
          className="p-4 rounded-full bg-gray-700"
          aria-label="Settings"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </button>
      </div>
    </div>
  );
}
```

### useMediaQuery Hook

```typescript
// src/hooks/useMediaQuery.ts
import { useState, useEffect } from 'react';

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(query).matches : false
  );

  useEffect(() => {
    const mediaQuery = window.matchMedia(query);
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);

    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, [query]);

  return matches;
}
```

### Responsive Video Grid

```typescript
// src/components/video/TileGrid.tsx - responsive version
export function TileGrid() {
  const isMobile = useMediaQuery('(max-width: 640px)');
  const isTablet = useMediaQuery('(max-width: 1024px)');

  const gridCols = isMobile ? 'grid-cols-2' : isTablet ? 'grid-cols-3' : 'grid-cols-4';

  return (
    <div className={`grid ${gridCols} gap-2 mt-4`}>
      {/* tiles */}
    </div>
  );
}
```

## Additional CSS

```css
/* src/index.css - additions */
@layer utilities {
  .safe-area-pb {
    padding-bottom: env(safe-area-inset-bottom);
  }

  .safe-area-pt {
    padding-top: env(safe-area-inset-top);
  }
}

/* Hide scrollbar but allow scrolling */
.no-scrollbar {
  -ms-overflow-style: none;
  scrollbar-width: none;
}

.no-scrollbar::-webkit-scrollbar {
  display: none;
}

/* Screen reader only */
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border-width: 0;
}
```

## Files to Create/Modify

1. `src/types/errors.ts`
2. `src/store/errorStore.ts`
3. `src/components/ui/ErrorToast.tsx`
4. `src/services/p2p/ReconnectionManager.ts`
5. `src/services/media/QualityAdapter.ts`
6. `src/services/compositing/LazyFFmpeg.ts`
7. `src/hooks/useFocusTrap.ts`
8. `src/hooks/useMediaQuery.ts`
9. `src/components/ui/ScreenReaderAnnounce.tsx`
10. `src/components/layout/MobileControls.tsx`
11. Update `src/components/video/TileGrid.tsx`
12. Update `src/components/layout/MainLayout.tsx`
13. Update `src/index.css`
