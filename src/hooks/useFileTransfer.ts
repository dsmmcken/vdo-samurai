import { useEffect, useCallback, useRef } from 'react';
import { useTransferStore, type Transfer, type RecordingType } from '../store/transferStore';
import { usePeerStore } from '../store/peerStore';
import { useSessionStore } from '../store/sessionStore';
import { useTrystero } from '../contexts/TrysteroContext';
import { FileTransferProtocol } from '../utils/FileTransferProtocol';
import { TRANSFER_CONFIG } from '../utils/transferConfig';

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

// Throttle progress broadcasts to avoid flooding the network
const PROGRESS_BROADCAST_INTERVAL_MS = 500;
const PROGRESS_BROADCAST_THRESHOLD = 0.1; // 10%

// Parse recording type from filename (e.g., "camera-recording-123.webm" or "screen-recording-123.webm")
function parseRecordingType(filename: string): RecordingType {
  if (filename.includes('screen-')) {
    return 'screen';
  }
  return 'camera';
}

export function useFileTransfer() {
  const { room, selfId, broadcastTransferStatus } = useTrystero();
  const { transfers, setTransfers, addReceivedRecording, isTransferring } = useTransferStore();
  const { peers } = usePeerStore();
  const { userName } = useSessionStore();
  const initializedRef = useRef(false);

  // Transfer queue and protocol management
  const queueRef = useRef<QueuedTransfer[]>([]);
  const protocolsRef = useRef<Map<string, FileTransferProtocol>>(new Map());
  const activeCountRef = useRef(0);
  const sendTransferRef = useRef<((data: unknown, peerId: string) => void) | null>(null);

  // Track last broadcast time and progress for throttling
  const lastBroadcastRef = useRef<Map<string, { time: number; progress: number }>>(new Map());

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

  const updateStoreFromQueue = useCallback(() => {
    const senderName = userName || 'Anonymous';
    const transferList: Transfer[] = queueRef.current.map((q) => ({
      id: q.id,
      peerId: q.peerId,
      peerName: q.peerName,
      filename: q.filename,
      size: q.blob.size,
      progress: q.progress,
      status: q.status,
      error: q.error,
      direction: 'send' as const,
      role: 'sender' as const,
      senderId: selfId,
      senderName: senderName,
      receiverId: q.peerId,
      receiverName: q.peerName
    }));
    setTransfers(transferList);
  }, [setTransfers, selfId, userName]);

  const updateQueuedTransfer = useCallback(
    (id: string, updates: Partial<QueuedTransfer>) => {
      const index = queueRef.current.findIndex((t) => t.id === id);
      if (index !== -1) {
        const oldTransfer = queueRef.current[index];
        queueRef.current[index] = { ...oldTransfer, ...updates };
        updateStoreFromQueue();

        const updatedTransfer = queueRef.current[index];
        const senderName = userName || 'Anonymous';

        // Determine if we should broadcast this update
        let shouldBroadcast = false;

        // Always broadcast status changes (pending->active, active->complete, error)
        if (updates.status && updates.status !== oldTransfer.status) {
          shouldBroadcast = true;
        }

        // Throttle progress updates: only broadcast if enough time or progress delta
        if (updates.progress !== undefined && !shouldBroadcast) {
          const lastBroadcast = lastBroadcastRef.current.get(id);
          const now = Date.now();
          const progressDelta = updates.progress - (lastBroadcast?.progress ?? 0);

          if (
            !lastBroadcast ||
            now - lastBroadcast.time >= PROGRESS_BROADCAST_INTERVAL_MS ||
            progressDelta >= PROGRESS_BROADCAST_THRESHOLD
          ) {
            shouldBroadcast = true;
          }
        }

        if (shouldBroadcast) {
          lastBroadcastRef.current.set(id, {
            time: Date.now(),
            progress: updatedTransfer.progress
          });

          broadcastTransferStatus({
            transferId: updatedTransfer.id,
            senderId: selfId,
            senderName: senderName,
            receiverId: updatedTransfer.peerId,
            receiverName: updatedTransfer.peerName,
            filename: updatedTransfer.filename,
            size: updatedTransfer.blob.size,
            progress: updatedTransfer.progress,
            status: updatedTransfer.status,
            error: updatedTransfer.error
          });
        }
      }
    },
    [updateStoreFromQueue, broadcastTransferStatus, selfId, userName]
  );

  const processNext = useCallback(async () => {
    if (activeCountRef.current >= TRANSFER_CONFIG.MAX_PARALLEL_TRANSFERS) return;

    const next = queueRef.current.find((t) => t.status === 'pending');
    if (!next) return;

    const protocol = protocolsRef.current.get(next.peerId);
    if (!protocol) {
      updateQueuedTransfer(next.id, { status: 'error', error: 'Peer not connected' });
      processNext();
      return;
    }

    activeCountRef.current++;
    updateQueuedTransfer(next.id, { status: 'active' });

    try {
      await protocol.sendFile(next.blob, next.filename, next.id, (sent, total) => {
        updateQueuedTransfer(next.id, { progress: sent / total });
      });
      updateQueuedTransfer(next.id, { status: 'complete', progress: 1 });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Transfer failed';
      updateQueuedTransfer(next.id, { status: 'error', error: message });
    } finally {
      activeCountRef.current--;
      processNext();
    }
  }, [updateQueuedTransfer]);

  const addPeer = useCallback(
    (peerId: string) => {
      if (protocolsRef.current.has(peerId) || !sendTransferRef.current) return;

      const sendTransfer = sendTransferRef.current;
      const protocol = new FileTransferProtocol();

      protocol.initialize((data) => {
        sendTransfer(data, peerId);
      });

      protocol.onProgress((transferId, progress) => {
        updateQueuedTransfer(transferId, { progress });
      });

      protocol.onComplete((transferId, blob, filename) => {
        updateQueuedTransfer(transferId, { status: 'complete', progress: 1 });
        const peer = peers.find((p) => p.id === peerId);
        const recordingType = parseRecordingType(filename || '');
        addReceivedRecording({
          peerId,
          peerName: peer?.name || `User-${peerId.slice(0, 4)}`,
          blob,
          receivedAt: Date.now(),
          type: recordingType
        });
      });

      protocol.onError((transferId, error) => {
        updateQueuedTransfer(transferId, { status: 'error', error });
      });

      protocolsRef.current.set(peerId, protocol);
    },
    [peers, addReceivedRecording, updateQueuedTransfer]
  );

  const removePeer = useCallback((peerId: string) => {
    const protocol = protocolsRef.current.get(peerId);
    protocol?.clear();
    protocolsRef.current.delete(peerId);
  }, []);

  useEffect(() => {
    if (room && !initializedRef.current) {
      initializedRef.current = true;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const [sendTransfer, onTransfer] = room.makeAction<any>('xfer');
      sendTransferRef.current = sendTransfer;

      // Handle incoming transfer messages
      onTransfer((data: unknown, peerId: string) => {
        const protocol = protocolsRef.current.get(peerId);
        protocol?.handleMessage(data);
      });

      // Add existing peers
      const existingPeers = room.getPeers();
      Object.keys(existingPeers).forEach((peerId) => {
        addPeer(peerId);
      });
    }

    // Capture ref values for cleanup
    const protocols = protocolsRef.current;

    return () => {
      if (initializedRef.current) {
        protocols.forEach((p) => p.clear());
        protocols.clear();
        queueRef.current = [];
        activeCountRef.current = 0;
        sendTransferRef.current = null;
        initializedRef.current = false;
      }
    };
  }, [room, addPeer]);

  // Watch for peer changes and add/remove protocols
  useEffect(() => {
    if (!room || !initializedRef.current) return;

    // Add new peers
    peers.forEach((peer) => {
      if (!protocolsRef.current.has(peer.id)) {
        addPeer(peer.id);
      }
    });

    // Remove departed peers
    const currentPeerIds = new Set(peers.map((p) => p.id));
    protocolsRef.current.forEach((_, peerId) => {
      if (!currentPeerIds.has(peerId)) {
        removePeer(peerId);
      }
    });
  }, [room, peers, addPeer, removePeer]);

  const enqueue = useCallback(
    (peerId: string, peerName: string, blob: Blob, filename: string): string => {
      const id = `transfer-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      const senderName = userName || 'Anonymous';

      queueRef.current.push({
        id,
        peerId,
        peerName,
        blob,
        filename,
        status: 'pending',
        progress: 0
      });

      updateStoreFromQueue();

      // Broadcast the new transfer to all peers
      broadcastTransferStatus({
        transferId: id,
        senderId: selfId,
        senderName: senderName,
        receiverId: peerId,
        receiverName: peerName,
        filename: filename,
        size: blob.size,
        progress: 0,
        status: 'pending'
      });

      processNext();

      return id;
    },
    [updateStoreFromQueue, processNext, broadcastTransferStatus, selfId, userName]
  );

  const sendRecording = useCallback(
    (peerId: string, blob: Blob, filename: string) => {
      const peer = peers.find((p) => p.id === peerId);
      const peerName = peer?.name || `User-${peerId.slice(0, 4)}`;
      return enqueue(peerId, peerName, blob, filename);
    },
    [peers, enqueue]
  );

  const sendToAllPeers = useCallback(
    (blob: Blob, filename: string) => {
      const ids: string[] = [];
      for (const peer of peers) {
        const id = enqueue(peer.id, peer.name, blob, filename);
        ids.push(id);
      }
      return ids;
    },
    [peers, enqueue]
  );

  // Send multiple recordings (camera and/or screen) to all peers
  const sendMultipleToAllPeers = useCallback(
    (recordings: Array<{ blob: Blob; type: RecordingType }>) => {
      const ids: string[] = [];
      for (const peer of peers) {
        for (const recording of recordings) {
          const filename = `${recording.type}-recording-${Date.now()}.webm`;
          const id = enqueue(peer.id, peer.name, recording.blob, filename);
          ids.push(id);
        }
      }
      return ids;
    },
    [peers, enqueue]
  );

  const clearCompleted = useCallback(() => {
    queueRef.current = queueRef.current.filter(
      (t) => t.status === 'pending' || t.status === 'active'
    );
    updateStoreFromQueue();
  }, [updateStoreFromQueue]);

  return {
    transfers,
    sendRecording,
    sendToAllPeers,
    sendMultipleToAllPeers,
    isTransferring: isTransferring(),
    clearCompleted
  };
}
