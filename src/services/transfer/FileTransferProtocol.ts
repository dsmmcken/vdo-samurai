import { TRANSFER_CONFIG } from './config';

export interface TransferMetadata {
  id: string;
  filename: string;
  size: number;
  mimeType: string;
  hash: string;
  totalChunks: number;
}

export interface TransferMessage {
  type: 'metadata' | 'chunk' | 'ack' | 'error';
  transferId: string;
  payload?: unknown;
}

export interface ChunkMessage {
  index: number;
  data: string; // base64 encoded
}

export interface AckMessage {
  receivedChunks: number;
  complete: boolean;
  hash?: string;
}

type ProgressCallback = (transferId: string, progress: number) => void;
type CompleteCallback = (transferId: string, blob: Blob, filename: string) => void;
type ErrorCallback = (transferId: string, error: string) => void;

export class FileTransferProtocol {
  private sendMessage: ((data: unknown) => void) | null = null;
  private pendingTransfers: Map<
    string,
    {
      metadata: TransferMetadata;
      chunks: (ArrayBuffer | null)[];
      receivedCount: number;
    }
  > = new Map();

  private onProgressCallback: ProgressCallback | null = null;
  private onCompleteCallback: CompleteCallback | null = null;
  private onErrorCallback: ErrorCallback | null = null;

  // For sending - track acks
  private pendingSends: Map<
    string,
    {
      resolve: () => void;
      reject: (error: Error) => void;
    }
  > = new Map();

  initialize(sendFn: (data: unknown) => void): void {
    this.sendMessage = sendFn;
  }

  handleMessage(data: unknown): void {
    if (typeof data !== 'object' || data === null) return;

    const message = data as TransferMessage;

    switch (message.type) {
      case 'metadata':
        this.handleMetadata(message.transferId, message.payload as TransferMetadata);
        break;
      case 'chunk':
        this.handleChunk(message.transferId, message.payload as ChunkMessage);
        break;
      case 'ack':
        this.handleAck(message.transferId, message.payload as AckMessage);
        break;
      case 'error':
        this.handleError(message.transferId, message.payload as string);
        break;
    }
  }

  private handleMetadata(transferId: string, metadata: TransferMetadata): void {
    this.pendingTransfers.set(transferId, {
      metadata,
      chunks: new Array(metadata.totalChunks).fill(null),
      receivedCount: 0
    });
  }

  private handleChunk(transferId: string, chunk: ChunkMessage): void {
    const transfer = this.pendingTransfers.get(transferId);
    if (!transfer) return;

    // Decode base64 to ArrayBuffer
    const binaryString = atob(chunk.data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    transfer.chunks[chunk.index] = bytes.buffer;
    transfer.receivedCount++;

    const progress = transfer.receivedCount / transfer.metadata.totalChunks;
    this.onProgressCallback?.(transferId, progress);

    // Check if complete
    if (transfer.receivedCount === transfer.metadata.totalChunks) {
      this.finalizeReceive(transferId, transfer);
    }
  }

  private async finalizeReceive(
    transferId: string,
    transfer: { metadata: TransferMetadata; chunks: (ArrayBuffer | null)[]; receivedCount: number }
  ): Promise<void> {
    const validChunks = transfer.chunks.filter((c): c is ArrayBuffer => c !== null);
    const blob = new Blob(validChunks, { type: transfer.metadata.mimeType });

    // Verify hash
    const hash = await this.computeHash(blob);

    // Send ACK
    this.sendMessage?.({
      type: 'ack',
      transferId,
      payload: {
        receivedChunks: transfer.receivedCount,
        complete: true,
        hash
      } as AckMessage
    });

    if (hash !== transfer.metadata.hash) {
      this.onErrorCallback?.(transferId, 'Hash mismatch - transfer corrupted');
    } else {
      this.onCompleteCallback?.(transferId, blob, transfer.metadata.filename);
    }

    this.pendingTransfers.delete(transferId);
  }

  private handleAck(transferId: string, ack: AckMessage): void {
    if (ack.complete) {
      const pending = this.pendingSends.get(transferId);
      if (pending) {
        pending.resolve();
        this.pendingSends.delete(transferId);
      }
    }
  }

  private handleError(transferId: string, error: string): void {
    this.onErrorCallback?.(transferId, error);

    const pending = this.pendingSends.get(transferId);
    if (pending) {
      pending.reject(new Error(error));
      this.pendingSends.delete(transferId);
    }
  }

  async sendFile(
    blob: Blob,
    filename: string,
    transferId: string,
    onChunkProgress?: (sent: number, total: number) => void
  ): Promise<void> {
    if (!this.sendMessage) {
      throw new Error('Protocol not initialized');
    }

    const hash = await this.computeHash(blob);
    const totalChunks = Math.ceil(blob.size / TRANSFER_CONFIG.CHUNK_SIZE);

    const metadata: TransferMetadata = {
      id: transferId,
      filename,
      size: blob.size,
      mimeType: blob.type || 'video/webm',
      hash,
      totalChunks
    };

    // Send metadata
    this.sendMessage({
      type: 'metadata',
      transferId,
      payload: metadata
    });

    // Send chunks
    const arrayBuffer = await blob.arrayBuffer();

    for (let i = 0; i < totalChunks; i++) {
      const start = i * TRANSFER_CONFIG.CHUNK_SIZE;
      const end = Math.min(start + TRANSFER_CONFIG.CHUNK_SIZE, blob.size);
      const chunkData = arrayBuffer.slice(start, end);

      // Convert to base64 for JSON transport
      const bytes = new Uint8Array(chunkData);
      let binary = '';
      for (let j = 0; j < bytes.length; j++) {
        binary += String.fromCharCode(bytes[j]);
      }
      const base64 = btoa(binary);

      const chunkMessage: ChunkMessage = {
        index: i,
        data: base64
      };

      this.sendMessage({
        type: 'chunk',
        transferId,
        payload: chunkMessage
      });

      onChunkProgress?.(i + 1, totalChunks);

      // Small delay to prevent overwhelming the channel
      if (i % 10 === 0) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }

    // Wait for ACK with timeout
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingSends.delete(transferId);
        reject(new Error('Transfer acknowledgment timeout'));
      }, TRANSFER_CONFIG.ACK_TIMEOUT);

      this.pendingSends.set(transferId, {
        resolve: () => {
          clearTimeout(timeout);
          resolve();
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        }
      });
    });
  }

  private async computeHash(blob: Blob): Promise<string> {
    const buffer = await blob.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  onProgress(callback: ProgressCallback): void {
    this.onProgressCallback = callback;
  }

  onComplete(callback: CompleteCallback): void {
    this.onCompleteCallback = callback;
  }

  onError(callback: ErrorCallback): void {
    this.onErrorCallback = callback;
  }

  clear(): void {
    this.pendingTransfers.clear();
    this.pendingSends.clear();
    this.sendMessage = null;
    this.onProgressCallback = null;
    this.onCompleteCallback = null;
    this.onErrorCallback = null;
  }
}
