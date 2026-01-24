import { useEffect, useCallback, useRef } from 'react';
import { type Room } from 'trystero/torrent';
import { useTransferStore, type Transfer } from '../store/transferStore';
import { usePeerStore } from '../store/peerStore';
import { transferService, type QueuedTransfer } from '../services/transfer';

export function useFileTransfer(room?: Room) {
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

      transferService.onReceive((peerId, blob) => {
        const peer = peers.find((p) => p.id === peerId);
        addReceivedRecording({
          peerId,
          peerName: peer?.name || `User-${peerId.slice(0, 4)}`,
          blob,
          receivedAt: Date.now()
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

  return {
    transfers,
    sendRecording,
    sendToAllPeers,
    isTransferring: isTransferring(),
    clearCompleted: () => transferService.clearCompleted()
  };
}
