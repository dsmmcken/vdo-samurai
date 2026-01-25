import { useEffect, useCallback, useRef } from 'react';
import { useTransferStore, type Transfer, type RecordingType } from '../store/transferStore';
import { usePeerStore } from '../store/peerStore';
import { useTrystero } from '../contexts/TrysteroContext';
import { transferService, type QueuedTransfer } from '../services/transfer';

// Parse recording type from filename (e.g., "camera-recording-123.webm" or "screen-recording-123.webm")
function parseRecordingType(filename: string): RecordingType {
  if (filename.includes('screen-')) {
    return 'screen';
  }
  return 'camera';
}

export function useFileTransfer() {
  const { room } = useTrystero();
  const { transfers, setTransfers, addReceivedRecording, isTransferring } = useTransferStore();
  const { peers } = usePeerStore();
  const initializedRef = useRef(false);

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

  useEffect(() => {
    if (room && !initializedRef.current) {
      initializedRef.current = true;
      transferService.initialize(room);

      transferService.onUpdate((queue: QueuedTransfer[]) => {
        const transferList: Transfer[] = queue.map((q) => ({
          id: q.id,
          peerId: q.peerId,
          peerName: q.peerName,
          filename: q.filename,
          size: q.blob.size,
          progress: q.progress,
          status: q.status,
          error: q.error,
          direction: 'send' as const
        }));
        setTransfers(transferList);
      });

      transferService.onReceive((peerId, blob, filename) => {
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
    }

    return () => {
      if (initializedRef.current) {
        transferService.clear();
        initializedRef.current = false;
      }
    };
  }, [room, peers, setTransfers, addReceivedRecording]);

  const sendRecording = useCallback(
    (peerId: string, blob: Blob, filename: string) => {
      const peer = peers.find((p) => p.id === peerId);
      const peerName = peer?.name || `User-${peerId.slice(0, 4)}`;
      return transferService.enqueue(peerId, peerName, blob, filename);
    },
    [peers]
  );

  const sendToAllPeers = useCallback(
    (blob: Blob, filename: string) => {
      const ids: string[] = [];
      for (const peer of peers) {
        const id = transferService.enqueue(peer.id, peer.name, blob, filename);
        ids.push(id);
      }
      return ids;
    },
    [peers]
  );

  // Send multiple recordings (camera and/or screen) to all peers
  const sendMultipleToAllPeers = useCallback(
    (recordings: Array<{ blob: Blob; type: RecordingType }>) => {
      const ids: string[] = [];
      for (const peer of peers) {
        for (const recording of recordings) {
          const filename = `${recording.type}-recording-${Date.now()}.webm`;
          const id = transferService.enqueue(peer.id, peer.name, recording.blob, filename);
          ids.push(id);
        }
      }
      return ids;
    },
    [peers]
  );

  return {
    transfers,
    sendRecording,
    sendToAllPeers,
    sendMultipleToAllPeers,
    isTransferring: isTransferring(),
    clearCompleted: () => transferService.clearCompleted()
  };
}
