import { type Room } from 'trystero/torrent';
import { FileTransferProtocol } from './FileTransferProtocol';
import { TRANSFER_CONFIG } from './config';

export interface QueuedTransfer {
  id: string;
  peerId: string;
  peerName: string;
  blob: Blob;
  filename: string;
  status: 'pending' | 'active' | 'complete' | 'error';
  progress: number;
  error?: string;
}

type TransferUpdateCallback = (transfers: QueuedTransfer[]) => void;
type TransferCompleteCallback = (peerId: string, blob: Blob, filename: string) => void;

export class TransferService {
  private protocols: Map<string, FileTransferProtocol> = new Map();
  private queue: QueuedTransfer[] = [];
  private activeCount = 0;
  private onUpdateCallback: TransferUpdateCallback | null = null;
  private onReceiveCallback: TransferCompleteCallback | null = null;

  initialize(room: Room): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [sendTransfer, onTransfer] = room.makeAction<any>('xfer');

    // Setup protocol for each peer
    room.onPeerJoin((peerId) => {
      const protocol = new FileTransferProtocol();

      protocol.initialize((data) => {
        sendTransfer(data, peerId);
      });

      protocol.onProgress((transferId, progress) => {
        this.updateTransfer(transferId, { progress });
      });

      protocol.onComplete((transferId, blob, filename) => {
        this.updateTransfer(transferId, { status: 'complete', progress: 1 });
        this.onReceiveCallback?.(peerId, blob, filename);
      });

      protocol.onError((transferId, error) => {
        this.updateTransfer(transferId, { status: 'error', error });
      });

      this.protocols.set(peerId, protocol);
    });

    room.onPeerLeave((peerId) => {
      const protocol = this.protocols.get(peerId);
      protocol?.clear();
      this.protocols.delete(peerId);
    });

    // Handle incoming transfer messages
    onTransfer((data: unknown, peerId: string) => {
      const protocol = this.protocols.get(peerId);
      protocol?.handleMessage(data);
    });
  }

  enqueue(peerId: string, peerName: string, blob: Blob, filename: string): string {
    const id = `transfer-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    this.queue.push({
      id,
      peerId,
      peerName,
      blob,
      filename,
      status: 'pending',
      progress: 0
    });

    this.notifyUpdate();
    this.processNext();

    return id;
  }

  private async processNext(): Promise<void> {
    if (this.activeCount >= TRANSFER_CONFIG.MAX_PARALLEL_TRANSFERS) return;

    const next = this.queue.find((t) => t.status === 'pending');
    if (!next) return;

    const protocol = this.protocols.get(next.peerId);
    if (!protocol) {
      this.updateTransfer(next.id, { status: 'error', error: 'Peer not connected' });
      this.processNext();
      return;
    }

    this.activeCount++;
    this.updateTransfer(next.id, { status: 'active' });

    try {
      await protocol.sendFile(next.blob, next.filename, next.id, (sent, total) => {
        this.updateTransfer(next.id, { progress: sent / total });
      });
      this.updateTransfer(next.id, { status: 'complete', progress: 1 });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Transfer failed';
      this.updateTransfer(next.id, { status: 'error', error: message });
    } finally {
      this.activeCount--;
      this.processNext();
    }
  }

  private updateTransfer(id: string, updates: Partial<QueuedTransfer>): void {
    const index = this.queue.findIndex((t) => t.id === id);
    if (index !== -1) {
      this.queue[index] = { ...this.queue[index], ...updates };
      this.notifyUpdate();
    }
  }

  private notifyUpdate(): void {
    this.onUpdateCallback?.([...this.queue]);
  }

  onUpdate(callback: TransferUpdateCallback): void {
    this.onUpdateCallback = callback;
  }

  onReceive(callback: TransferCompleteCallback): void {
    this.onReceiveCallback = callback;
  }

  getQueue(): QueuedTransfer[] {
    return [...this.queue];
  }

  isTransferring(): boolean {
    return this.queue.some((t) => t.status === 'pending' || t.status === 'active');
  }

  getActiveCount(): number {
    return this.activeCount;
  }

  clearCompleted(): void {
    this.queue = this.queue.filter((t) => t.status === 'pending' || t.status === 'active');
    this.notifyUpdate();
  }

  clear(): void {
    this.queue = [];
    this.activeCount = 0;
    this.protocols.forEach((p) => p.clear());
    this.protocols.clear();
    this.onUpdateCallback = null;
    this.onReceiveCallback = null;
  }
}

export const transferService = new TransferService();
