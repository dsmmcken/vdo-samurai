# Phase 3: Recording System

## Tasks
- [ ] LocalRecorder with optimal codec detection (VP9 > VP8)
- [ ] RecordingCoordinator for synchronized start/stop
- [ ] RecordButton (host only)
- [ ] CountdownOverlay (3-2-1 animation)
- [ ] OnAirIndicator in top-right
- [ ] Edit point logging during recording
- [ ] Temporary storage in IndexedDB

## Recording Configuration

```typescript
// src/services/recording/config.ts
export function getOptimalMimeType(): string {
  const types = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=h264,opus',
    'video/webm'
  ];

  for (const type of types) {
    if (MediaRecorder.isTypeSupported(type)) {
      return type;
    }
  }

  throw new Error('No supported video MIME type found');
}

export const RECORDING_OPTIONS = {
  videoBitsPerSecond: 8_000_000,  // 8 Mbps HQ
  audioBitsPerSecond: 128_000     // 128 kbps
};
```

## LocalRecorder Service

```typescript
// src/services/recording/LocalRecorder.ts
import { getOptimalMimeType, RECORDING_OPTIONS } from './config';
import { saveRecordingChunk, finalizeRecording } from '../storage/recordingStorage';

export class LocalRecorder {
  private mediaRecorder: MediaRecorder | null = null;
  private recordingId: string | null = null;
  private startTime: number = 0;

  async start(stream: MediaStream): Promise<string> {
    const mimeType = getOptimalMimeType();
    this.recordingId = `recording-${Date.now()}`;
    this.startTime = Date.now();

    this.mediaRecorder = new MediaRecorder(stream, {
      mimeType,
      ...RECORDING_OPTIONS
    });

    this.mediaRecorder.ondataavailable = async (event) => {
      if (event.data.size > 0 && this.recordingId) {
        await saveRecordingChunk(this.recordingId, event.data);
      }
    };

    // Request data every 5 seconds for progressive saving
    this.mediaRecorder.start(5000);

    return this.recordingId;
  }

  stop(): Promise<Blob> {
    return new Promise((resolve, reject) => {
      if (!this.mediaRecorder || !this.recordingId) {
        reject(new Error('No active recording'));
        return;
      }

      this.mediaRecorder.onstop = async () => {
        try {
          const blob = await finalizeRecording(this.recordingId!);
          resolve(blob);
        } catch (err) {
          reject(err);
        }
      };

      this.mediaRecorder.stop();
    });
  }

  isRecording(): boolean {
    return this.mediaRecorder?.state === 'recording';
  }

  getElapsedTime(): number {
    return this.isRecording() ? Date.now() - this.startTime : 0;
  }
}
```

## IndexedDB Storage

```typescript
// src/services/storage/recordingStorage.ts
const DB_NAME = 'vdo-samurai-recordings';
const DB_VERSION = 1;
const CHUNKS_STORE = 'chunks';
const RECORDINGS_STORE = 'recordings';

let db: IDBDatabase | null = null;

async function getDB(): Promise<IDBDatabase> {
  if (db) return db;

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const database = (event.target as IDBOpenDBRequest).result;

      if (!database.objectStoreNames.contains(CHUNKS_STORE)) {
        database.createObjectStore(CHUNKS_STORE, { keyPath: ['recordingId', 'index'] });
      }

      if (!database.objectStoreNames.contains(RECORDINGS_STORE)) {
        database.createObjectStore(RECORDINGS_STORE, { keyPath: 'id' });
      }
    };
  });
}

export async function saveRecordingChunk(recordingId: string, chunk: Blob): Promise<void> {
  const database = await getDB();
  const tx = database.transaction(CHUNKS_STORE, 'readwrite');
  const store = tx.objectStore(CHUNKS_STORE);

  // Get current chunk count
  const countRequest = store.count();
  const count = await new Promise<number>((resolve) => {
    countRequest.onsuccess = () => resolve(countRequest.result);
  });

  await new Promise<void>((resolve, reject) => {
    const request = store.add({
      recordingId,
      index: count,
      data: chunk,
      timestamp: Date.now()
    });
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function finalizeRecording(recordingId: string): Promise<Blob> {
  const database = await getDB();
  const tx = database.transaction(CHUNKS_STORE, 'readonly');
  const store = tx.objectStore(CHUNKS_STORE);

  const chunks: Blob[] = [];

  return new Promise((resolve, reject) => {
    const request = store.openCursor();

    request.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest).result;
      if (cursor) {
        if (cursor.value.recordingId === recordingId) {
          chunks.push(cursor.value.data);
        }
        cursor.continue();
      } else {
        // All chunks collected
        const blob = new Blob(chunks, { type: chunks[0]?.type || 'video/webm' });
        resolve(blob);
      }
    };

    request.onerror = () => reject(request.error);
  });
}

export async function deleteRecording(recordingId: string): Promise<void> {
  const database = await getDB();
  const tx = database.transaction(CHUNKS_STORE, 'readwrite');
  const store = tx.objectStore(CHUNKS_STORE);

  return new Promise((resolve, reject) => {
    const request = store.openCursor();

    request.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest).result;
      if (cursor) {
        if (cursor.value.recordingId === recordingId) {
          cursor.delete();
        }
        cursor.continue();
      } else {
        resolve();
      }
    };

    request.onerror = () => reject(request.error);
  });
}
```

## RecordingCoordinator (Host)

```typescript
// src/services/recording/RecordingCoordinator.ts
import { Room } from 'trystero/torrent';

export interface RecordingMessage {
  type: 'recording-start' | 'recording-stop' | 'recording-countdown';
  timestamp: number;
  countdown?: number;
}

export class RecordingCoordinator {
  private room: Room | null = null;
  private sendRecordingMessage: ((data: RecordingMessage) => void) | null = null;
  private onRecordingMessage: ((callback: (data: RecordingMessage, peerId: string) => void) => void) | null = null;
  private countdownCallback: ((count: number) => void) | null = null;
  private startCallback: (() => void) | null = null;
  private stopCallback: (() => void) | null = null;

  initialize(room: Room): void {
    this.room = room;

    const [sendRecording, onRecording] = room.makeAction<RecordingMessage>('recording');
    this.sendRecordingMessage = sendRecording;

    onRecording((data) => {
      switch (data.type) {
        case 'recording-countdown':
          this.countdownCallback?.(data.countdown!);
          break;
        case 'recording-start':
          this.startCallback?.();
          break;
        case 'recording-stop':
          this.stopCallback?.();
          break;
      }
    });
  }

  // Host triggers countdown
  async triggerCountdown(): Promise<void> {
    for (let i = 3; i >= 1; i--) {
      this.sendRecordingMessage?.({ type: 'recording-countdown', countdown: i, timestamp: Date.now() });
      this.countdownCallback?.(i);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  // Host triggers start
  triggerStart(): void {
    this.sendRecordingMessage?.({ type: 'recording-start', timestamp: Date.now() });
    this.startCallback?.();
  }

  // Host triggers stop
  triggerStop(): void {
    this.sendRecordingMessage?.({ type: 'recording-stop', timestamp: Date.now() });
    this.stopCallback?.();
  }

  onCountdown(callback: (count: number) => void): void {
    this.countdownCallback = callback;
  }

  onStart(callback: () => void): void {
    this.startCallback = callback;
  }

  onStop(callback: () => void): void {
    this.stopCallback = callback;
  }
}
```

## Recording Store

```typescript
// src/store/recordingStore.ts
import { create } from 'zustand';

interface EditPoint {
  timestamp: number;
  focusedPeerId: string | null;
  type: 'focus-change' | 'marker';
}

interface RecordingState {
  isRecording: boolean;
  countdown: number | null;
  startTime: number | null;
  editPoints: EditPoint[];
  recordingId: string | null;

  setIsRecording: (recording: boolean) => void;
  setCountdown: (count: number | null) => void;
  setStartTime: (time: number | null) => void;
  addEditPoint: (point: EditPoint) => void;
  clearEditPoints: () => void;
  setRecordingId: (id: string | null) => void;
}

export const useRecordingStore = create<RecordingState>((set) => ({
  isRecording: false,
  countdown: null,
  startTime: null,
  editPoints: [],
  recordingId: null,

  setIsRecording: (isRecording) => set({ isRecording }),
  setCountdown: (countdown) => set({ countdown }),
  setStartTime: (startTime) => set({ startTime }),
  addEditPoint: (point) => set((state) => ({
    editPoints: [...state.editPoints, point]
  })),
  clearEditPoints: () => set({ editPoints: [] }),
  setRecordingId: (recordingId) => set({ recordingId })
}));
```

## useRecording Hook

```typescript
// src/hooks/useRecording.ts
import { useCallback, useRef, useEffect } from 'react';
import { useRecordingStore } from '../store/recordingStore';
import { useSessionStore } from '../store/sessionStore';
import { LocalRecorder } from '../services/recording/LocalRecorder';
import { RecordingCoordinator } from '../services/recording/RecordingCoordinator';

export function useRecording(room?: Room) {
  const recorderRef = useRef(new LocalRecorder());
  const coordinatorRef = useRef(new RecordingCoordinator());
  const { localStream, isHost } = useSessionStore();
  const {
    isRecording,
    countdown,
    setIsRecording,
    setCountdown,
    setStartTime,
    setRecordingId
  } = useRecordingStore();

  useEffect(() => {
    if (room) {
      coordinatorRef.current.initialize(room);

      coordinatorRef.current.onCountdown((count) => {
        setCountdown(count);
      });

      coordinatorRef.current.onStart(async () => {
        if (localStream) {
          setCountdown(null);
          const id = await recorderRef.current.start(localStream);
          setRecordingId(id);
          setIsRecording(true);
          setStartTime(Date.now());
        }
      });

      coordinatorRef.current.onStop(async () => {
        if (recorderRef.current.isRecording()) {
          await recorderRef.current.stop();
          setIsRecording(false);
        }
      });
    }
  }, [room, localStream]);

  const startRecording = useCallback(async () => {
    if (!isHost) return;

    await coordinatorRef.current.triggerCountdown();
    coordinatorRef.current.triggerStart();
  }, [isHost]);

  const stopRecording = useCallback(() => {
    if (!isHost) return;

    coordinatorRef.current.triggerStop();
  }, [isHost]);

  return {
    isRecording,
    countdown,
    startRecording,
    stopRecording,
    isHost
  };
}
```

## RecordButton Component

```typescript
// src/components/recording/RecordButton.tsx
import { useRecording } from '../../hooks/useRecording';

export function RecordButton() {
  const { isRecording, startRecording, stopRecording, isHost } = useRecording();

  if (!isHost) return null;

  return (
    <button
      onClick={isRecording ? stopRecording : startRecording}
      className={`
        px-6 py-3 rounded-full font-medium transition-all
        flex items-center gap-2
        ${isRecording
          ? 'bg-red-500 hover:bg-red-600 text-white animate-pulse'
          : 'bg-primary hover:bg-primary/80 text-white'
        }
      `}
    >
      <span className={`w-3 h-3 rounded-full ${isRecording ? 'bg-white' : 'bg-red-500'}`} />
      {isRecording ? 'Stop Recording' : 'Start Recording'}
    </button>
  );
}
```

## CountdownOverlay Component

```typescript
// src/components/recording/CountdownOverlay.tsx
import { useRecordingStore } from '../../store/recordingStore';

export function CountdownOverlay() {
  const { countdown } = useRecordingStore();

  if (countdown === null) return null;

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
      <div className="text-9xl font-bold text-white animate-bounce">
        {countdown}
      </div>
    </div>
  );
}
```

## OnAirIndicator Component

```typescript
// src/components/recording/OnAirIndicator.tsx
import { useRecordingStore } from '../../store/recordingStore';

export function OnAirIndicator() {
  const { isRecording, startTime } = useRecordingStore();
  const [elapsed, setElapsed] = useState('00:00');

  useEffect(() => {
    if (!isRecording || !startTime) return;

    const interval = setInterval(() => {
      const seconds = Math.floor((Date.now() - startTime) / 1000);
      const mins = Math.floor(seconds / 60);
      const secs = seconds % 60;
      setElapsed(`${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`);
    }, 1000);

    return () => clearInterval(interval);
  }, [isRecording, startTime]);

  if (!isRecording) return null;

  return (
    <div className="fixed top-4 right-4 flex items-center gap-2 bg-red-500 text-white px-4 py-2 rounded-lg z-40">
      <span className="w-3 h-3 rounded-full bg-white animate-pulse" />
      <span className="font-mono font-bold">ON AIR</span>
      <span className="font-mono text-sm">{elapsed}</span>
    </div>
  );
}
```

## Edit Point Logging

```typescript
// src/hooks/useEditPoints.ts
import { useEffect } from 'react';
import { useRecordingStore } from '../store/recordingStore';
import { useSessionStore } from '../store/sessionStore';

export function useEditPoints() {
  const { isRecording, addEditPoint, startTime } = useRecordingStore();
  const { focusedPeerId } = useSessionStore();

  // Log focus changes as edit points during recording
  useEffect(() => {
    if (isRecording && startTime) {
      addEditPoint({
        timestamp: Date.now() - startTime,
        focusedPeerId,
        type: 'focus-change'
      });
    }
  }, [focusedPeerId, isRecording, startTime, addEditPoint]);

  const addMarker = () => {
    if (isRecording && startTime) {
      addEditPoint({
        timestamp: Date.now() - startTime,
        focusedPeerId,
        type: 'marker'
      });
    }
  };

  return { addMarker };
}
```

## Files to Create

1. `src/services/recording/config.ts`
2. `src/services/recording/LocalRecorder.ts`
3. `src/services/recording/RecordingCoordinator.ts`
4. `src/services/storage/recordingStorage.ts`
5. `src/store/recordingStore.ts`
6. `src/hooks/useRecording.ts`
7. `src/hooks/useEditPoints.ts`
8. `src/components/recording/RecordButton.tsx`
9. `src/components/recording/CountdownOverlay.tsx`
10. `src/components/recording/OnAirIndicator.tsx`
