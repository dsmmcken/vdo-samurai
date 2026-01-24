# Phase 4: File Transfer

## Tasks
- [ ] FileTransferProtocol with 64KB chunking
- [ ] Backpressure handling via bufferedAmount
- [ ] TransferProgress UI with per-peer status
- [ ] SHA-256 hash verification
- [ ] beforeunload warning during transfer
- [ ] TransferQueue for parallel transfers

## Transfer Protocol Configuration

```typescript
// src/services/transfer/config.ts
export const TRANSFER_CONFIG = {
  CHUNK_SIZE: 64 * 1024,         // 64KB chunks
  HIGH_WATERMARK: 1024 * 1024,   // 1MB buffer limit - pause sending
  LOW_WATERMARK: 256 * 1024,     // 256KB - resume sending
  MAX_PARALLEL_TRANSFERS: 3,
  ACK_TIMEOUT: 30000             // 30s timeout for ACK
};
```

## File Transfer Protocol

```typescript
// src/services/transfer/FileTransferProtocol.ts
import { TRANSFER_CONFIG } from './config';

export interface TransferMetadata {
  id: string;
  filename: string;
  size: number;
  mimeType: string;
  hash?: string;
  totalChunks: number;
}

export interface TransferChunk {
  transferId: string;
  index: number;
  data: ArrayBuffer;
}

export interface TransferAck {
  transferId: string;
  receivedChunks: number;
  complete: boolean;
  hash?: string;
}

export class FileTransferProtocol {
  private dataChannel: RTCDataChannel | null = null;
  private pendingTransfers: Map<string, {
    metadata: TransferMetadata;
    chunks: ArrayBuffer[];
    receivedCount: number;
  }> = new Map();

  private onProgressCallback: ((transferId: string, progress: number) => void) | null = null;
  private onCompleteCallback: ((transferId: string, blob: Blob) => void) | null = null;
  private onErrorCallback: ((transferId: string, error: string) => void) | null = null;

  constructor(dataChannel: RTCDataChannel) {
    this.dataChannel = dataChannel;
    this.dataChannel.binaryType = 'arraybuffer';

    this.dataChannel.onmessage = (event) => {
      this.handleMessage(event.data);
    };
  }

  private async handleMessage(data: ArrayBuffer | string): Promise<void> {
    if (typeof data === 'string') {
      const message = JSON.parse(data);

      if (message.type === 'metadata') {
        this.handleMetadata(message.payload as TransferMetadata);
      } else if (message.type === 'ack') {
        this.handleAck(message.payload as TransferAck);
      }
    } else {
      // Binary chunk data
      await this.handleChunk(data);
    }
  }

  private handleMetadata(metadata: TransferMetadata): void {
    this.pendingTransfers.set(metadata.id, {
      metadata,
      chunks: new Array(metadata.totalChunks),
      receivedCount: 0
    });
  }

  private async handleChunk(data: ArrayBuffer): Promise<void> {
    // First 36 bytes are transfer ID, next 4 bytes are chunk index
    const view = new DataView(data);
    const decoder = new TextDecoder();

    const transferId = decoder.decode(data.slice(0, 36));
    const chunkIndex = view.getUint32(36, true);
    const chunkData = data.slice(40);

    const transfer = this.pendingTransfers.get(transferId);
    if (!transfer) return;

    transfer.chunks[chunkIndex] = chunkData;
    transfer.receivedCount++;

    const progress = transfer.receivedCount / transfer.metadata.totalChunks;
    this.onProgressCallback?.(transferId, progress);

    // Check if complete
    if (transfer.receivedCount === transfer.metadata.totalChunks) {
      const blob = new Blob(transfer.chunks, { type: transfer.metadata.mimeType });

      // Verify hash
      const hash = await this.computeHash(blob);

      // Send ACK
      this.sendAck({
        transferId,
        receivedChunks: transfer.receivedCount,
        complete: true,
        hash
      });

      if (transfer.metadata.hash && hash !== transfer.metadata.hash) {
        this.onErrorCallback?.(transferId, 'Hash mismatch - transfer corrupted');
      } else {
        this.onCompleteCallback?.(transferId, blob);
      }

      this.pendingTransfers.delete(transferId);
    }
  }

  private handleAck(ack: TransferAck): void {
    // Handled by sender to confirm receipt
  }

  async sendFile(blob: Blob, filename: string): Promise<string> {
    const transferId = crypto.randomUUID();
    const hash = await this.computeHash(blob);
    const totalChunks = Math.ceil(blob.size / TRANSFER_CONFIG.CHUNK_SIZE);

    const metadata: TransferMetadata = {
      id: transferId,
      filename,
      size: blob.size,
      mimeType: blob.type,
      hash,
      totalChunks
    };

    // Send metadata
    this.dataChannel?.send(JSON.stringify({ type: 'metadata', payload: metadata }));

    // Send chunks with backpressure handling
    const arrayBuffer = await blob.arrayBuffer();

    for (let i = 0; i < totalChunks; i++) {
      await this.waitForBufferDrain();

      const start = i * TRANSFER_CONFIG.CHUNK_SIZE;
      const end = Math.min(start + TRANSFER_CONFIG.CHUNK_SIZE, blob.size);
      const chunkData = arrayBuffer.slice(start, end);

      // Create chunk with header (transferId + index + data)
      const header = new ArrayBuffer(40);
      const headerView = new DataView(header);
      const encoder = new TextEncoder();
      const idBytes = encoder.encode(transferId);

      // Copy transfer ID
      new Uint8Array(header).set(idBytes.slice(0, 36));
      // Set chunk index
      headerView.setUint32(36, i, true);

      // Combine header and chunk
      const combined = new Uint8Array(40 + chunkData.byteLength);
      combined.set(new Uint8Array(header), 0);
      combined.set(new Uint8Array(chunkData), 40);

      this.dataChannel?.send(combined.buffer);
    }

    return transferId;
  }

  private waitForBufferDrain(): Promise<void> {
    return new Promise((resolve) => {
      const check = () => {
        if (!this.dataChannel) {
          resolve();
          return;
        }

        if (this.dataChannel.bufferedAmount < TRANSFER_CONFIG.HIGH_WATERMARK) {
          resolve();
        } else {
          setTimeout(check, 50);
        }
      };
      check();
    });
  }

  private async computeHash(blob: Blob): Promise<string> {
    const buffer = await blob.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  private sendAck(ack: TransferAck): void {
    this.dataChannel?.send(JSON.stringify({ type: 'ack', payload: ack }));
  }

  onProgress(callback: (transferId: string, progress: number) => void): void {
    this.onProgressCallback = callback;
  }

  onComplete(callback: (transferId: string, blob: Blob) => void): void {
    this.onCompleteCallback = callback;
  }

  onError(callback: (transferId: string, error: string) => void): void {
    this.onErrorCallback = callback;
  }
}
```

## Transfer Queue

```typescript
// src/services/transfer/TransferQueue.ts
import { TRANSFER_CONFIG } from './config';

interface QueuedTransfer {
  id: string;
  peerId: string;
  blob: Blob;
  filename: string;
  status: 'pending' | 'active' | 'complete' | 'error';
  progress: number;
  error?: string;
}

export class TransferQueue {
  private queue: QueuedTransfer[] = [];
  private activeCount = 0;
  private protocols: Map<string, FileTransferProtocol> = new Map();
  private onQueueChange: ((queue: QueuedTransfer[]) => void) | null = null;

  registerProtocol(peerId: string, protocol: FileTransferProtocol): void {
    this.protocols.set(peerId, protocol);

    protocol.onProgress((transferId, progress) => {
      this.updateTransfer(transferId, { progress });
    });

    protocol.onComplete((transferId) => {
      this.updateTransfer(transferId, { status: 'complete', progress: 1 });
      this.activeCount--;
      this.processNext();
    });

    protocol.onError((transferId, error) => {
      this.updateTransfer(transferId, { status: 'error', error });
      this.activeCount--;
      this.processNext();
    });
  }

  enqueue(peerId: string, blob: Blob, filename: string): string {
    const id = crypto.randomUUID();

    this.queue.push({
      id,
      peerId,
      blob,
      filename,
      status: 'pending',
      progress: 0
    });

    this.notifyChange();
    this.processNext();

    return id;
  }

  private processNext(): void {
    if (this.activeCount >= TRANSFER_CONFIG.MAX_PARALLEL_TRANSFERS) return;

    const next = this.queue.find(t => t.status === 'pending');
    if (!next) return;

    const protocol = this.protocols.get(next.peerId);
    if (!protocol) {
      this.updateTransfer(next.id, { status: 'error', error: 'No connection to peer' });
      this.processNext();
      return;
    }

    this.activeCount++;
    this.updateTransfer(next.id, { status: 'active' });

    protocol.sendFile(next.blob, next.filename).catch((error) => {
      this.updateTransfer(next.id, { status: 'error', error: error.message });
      this.activeCount--;
      this.processNext();
    });
  }

  private updateTransfer(id: string, updates: Partial<QueuedTransfer>): void {
    const index = this.queue.findIndex(t => t.id === id);
    if (index !== -1) {
      this.queue[index] = { ...this.queue[index], ...updates };
      this.notifyChange();
    }
  }

  private notifyChange(): void {
    this.onQueueChange?.([...this.queue]);
  }

  onChange(callback: (queue: QueuedTransfer[]) => void): void {
    this.onQueueChange = callback;
  }

  getQueue(): QueuedTransfer[] {
    return [...this.queue];
  }

  isTransferring(): boolean {
    return this.queue.some(t => t.status === 'pending' || t.status === 'active');
  }
}
```

## Transfer Store

```typescript
// src/store/transferStore.ts
import { create } from 'zustand';

interface Transfer {
  id: string;
  peerId: string;
  peerName: string;
  filename: string;
  size: number;
  progress: number;
  status: 'pending' | 'active' | 'complete' | 'error';
  error?: string;
}

interface TransferState {
  transfers: Transfer[];
  addTransfer: (transfer: Transfer) => void;
  updateTransfer: (id: string, updates: Partial<Transfer>) => void;
  removeTransfer: (id: string) => void;
  clearTransfers: () => void;
  isTransferring: () => boolean;
}

export const useTransferStore = create<TransferState>((set, get) => ({
  transfers: [],

  addTransfer: (transfer) => set((state) => ({
    transfers: [...state.transfers, transfer]
  })),

  updateTransfer: (id, updates) => set((state) => ({
    transfers: state.transfers.map(t =>
      t.id === id ? { ...t, ...updates } : t
    )
  })),

  removeTransfer: (id) => set((state) => ({
    transfers: state.transfers.filter(t => t.id !== id)
  })),

  clearTransfers: () => set({ transfers: [] }),

  isTransferring: () => {
    const { transfers } = get();
    return transfers.some(t => t.status === 'pending' || t.status === 'active');
  }
}));
```

## useFileTransfer Hook

```typescript
// src/hooks/useFileTransfer.ts
import { useEffect, useRef, useCallback } from 'react';
import { useTransferStore } from '../store/transferStore';
import { TransferQueue } from '../services/transfer/TransferQueue';
import { FileTransferProtocol } from '../services/transfer/FileTransferProtocol';

export function useFileTransfer() {
  const queueRef = useRef(new TransferQueue());
  const { transfers, addTransfer, updateTransfer, isTransferring } = useTransferStore();

  // Setup beforeunload warning
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isTransferring()) {
        e.preventDefault();
        e.returnValue = 'File transfers are in progress. Are you sure you want to leave?';
        return e.returnValue;
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isTransferring]);

  const registerPeer = useCallback((peerId: string, dataChannel: RTCDataChannel) => {
    const protocol = new FileTransferProtocol(dataChannel);
    queueRef.current.registerProtocol(peerId, protocol);

    protocol.onProgress((transferId, progress) => {
      updateTransfer(transferId, { progress });
    });

    protocol.onComplete((transferId) => {
      updateTransfer(transferId, { status: 'complete', progress: 1 });
    });

    protocol.onError((transferId, error) => {
      updateTransfer(transferId, { status: 'error', error });
    });
  }, [updateTransfer]);

  const sendFile = useCallback((peerId: string, peerName: string, blob: Blob, filename: string) => {
    const id = queueRef.current.enqueue(peerId, blob, filename);

    addTransfer({
      id,
      peerId,
      peerName,
      filename,
      size: blob.size,
      progress: 0,
      status: 'pending'
    });

    return id;
  }, [addTransfer]);

  return {
    transfers,
    sendFile,
    registerPeer,
    isTransferring: isTransferring()
  };
}
```

## TransferProgress Component

```typescript
// src/components/recording/TransferProgress.tsx
import { useTransferStore } from '../../store/transferStore';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function TransferProgress() {
  const { transfers } = useTransferStore();

  const activeTransfers = transfers.filter(
    t => t.status === 'pending' || t.status === 'active'
  );

  if (activeTransfers.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 w-80 bg-dark-lighter rounded-lg p-4 shadow-xl z-40">
      <h3 className="text-sm font-semibold text-gray-300 mb-3">
        Transferring Recordings
      </h3>

      <div className="space-y-3">
        {activeTransfers.map(transfer => (
          <div key={transfer.id} className="space-y-1">
            <div className="flex justify-between text-sm">
              <span className="text-white">{transfer.peerName}</span>
              <span className="text-gray-400">
                {formatBytes(transfer.size * transfer.progress)} / {formatBytes(transfer.size)}
              </span>
            </div>

            <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-primary transition-all duration-300"
                style={{ width: `${transfer.progress * 100}%` }}
              />
            </div>

            {transfer.status === 'error' && (
              <p className="text-red-400 text-xs">{transfer.error}</p>
            )}
          </div>
        ))}
      </div>

      <p className="text-xs text-gray-500 mt-3">
        Don't close this window while transfers are in progress.
      </p>
    </div>
  );
}
```

## Files to Create

1. `src/services/transfer/config.ts`
2. `src/services/transfer/FileTransferProtocol.ts`
3. `src/services/transfer/TransferQueue.ts`
4. `src/store/transferStore.ts`
5. `src/hooks/useFileTransfer.ts`
6. `src/components/recording/TransferProgress.tsx`
