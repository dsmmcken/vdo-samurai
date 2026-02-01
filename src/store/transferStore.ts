import { create } from 'zustand';

export type RecordingType = 'camera' | 'screen';

export interface Transfer {
  id: string;
  peerId: string;
  peerName: string;
  filename: string;
  size: number;
  progress: number;
  status: 'pending' | 'active' | 'complete' | 'error';
  error?: string;
  direction: 'send' | 'receive';
  // Extended fields for broadcast status
  role: 'sender' | 'receiver' | 'observer'; // Local user's role in this transfer
  senderId: string;
  senderName: string;
  receiverId: string;
  receiverName: string;
}

export interface ReceivedRecording {
  peerId: string;
  peerName: string;
  blob: Blob;
  receivedAt: number;
  type: RecordingType;
}

export interface TransferBroadcast {
  transferId: string;
  senderId: string;
  senderName: string;
  receiverId: string;
  receiverName: string;
  filename: string;
  size: number;
  progress: number;
  status: 'pending' | 'active' | 'complete' | 'error';
  error?: string;
}

interface TransferState {
  transfers: Transfer[];
  receivedRecordings: ReceivedRecording[];
  indicatorDismissed: boolean;
  hasHadTransfers: boolean;

  setTransfers: (transfers: Transfer[]) => void;
  addTransfer: (transfer: Transfer) => void;
  updateTransfer: (id: string, updates: Partial<Transfer>) => void;
  removeTransfer: (id: string) => void;
  clearTransfers: () => void;
  upsertTransferFromBroadcast: (broadcast: TransferBroadcast, localUserId: string) => void;

  addReceivedRecording: (recording: ReceivedRecording) => void;
  clearReceivedRecordings: () => void;

  isTransferring: () => boolean;
  setIndicatorDismissed: (dismissed: boolean) => void;
  reset: () => void;

  // Dev only: simulate a race
  simulateRace: (durationMs?: number) => void;
}

export const useTransferStore = create<TransferState>((set, get) => ({
  transfers: [],
  receivedRecordings: [],
  indicatorDismissed: false,
  hasHadTransfers: false,

  setTransfers: (transfers) => {
    const hadTransfers = transfers.length > 0;
    set((state) => ({
      transfers,
      // Once we've had transfers, remember it (reset dismissed when new transfers arrive)
      hasHadTransfers: state.hasHadTransfers || hadTransfers,
      indicatorDismissed:
        hadTransfers && state.indicatorDismissed && transfers.length <= state.transfers.length
          ? state.indicatorDismissed
          : hadTransfers
            ? false
            : state.indicatorDismissed
    }));
  },

  addTransfer: (transfer) =>
    set((state) => ({
      transfers: [...state.transfers, transfer]
    })),

  updateTransfer: (id, updates) =>
    set((state) => ({
      transfers: state.transfers.map((t) => (t.id === id ? { ...t, ...updates } : t))
    })),

  removeTransfer: (id) =>
    set((state) => ({
      transfers: state.transfers.filter((t) => t.id !== id)
    })),

  clearTransfers: () => set({ transfers: [] }),

  upsertTransferFromBroadcast: (broadcast, localUserId) =>
    set((state) => {
      const existingIndex = state.transfers.findIndex((t) => t.id === broadcast.transferId);

      // Determine local user's role in this transfer
      const isSender = broadcast.senderId === localUserId;
      const isReceiver = broadcast.receiverId === localUserId;
      const role = isSender ? 'sender' : isReceiver ? 'receiver' : 'observer';

      // If local user is sender, they manage their own transfer data locally
      // Receivers and observers get updated from broadcasts
      if (existingIndex !== -1) {
        const existing = state.transfers[existingIndex];
        // Don't overwrite local sender data with broadcast (sender has authoritative local state)
        if (existing.role === 'sender') {
          return state;
        }
        // Update receiver/observer transfer from broadcast
        const updated = [...state.transfers];
        updated[existingIndex] = {
          ...existing,
          progress: broadcast.progress,
          status: broadcast.status,
          error: broadcast.error
        };
        return {
          transfers: updated,
          hasHadTransfers: true,
          indicatorDismissed: false
        };
      }

      // Create new transfer from broadcast
      const newTransfer: Transfer = {
        id: broadcast.transferId,
        peerId: isSender ? broadcast.receiverId : broadcast.senderId,
        peerName: isSender ? broadcast.receiverName : broadcast.senderName,
        filename: broadcast.filename,
        size: broadcast.size,
        progress: broadcast.progress,
        status: broadcast.status,
        error: broadcast.error,
        direction: isSender ? 'send' : 'receive',
        role,
        senderId: broadcast.senderId,
        senderName: broadcast.senderName,
        receiverId: broadcast.receiverId,
        receiverName: broadcast.receiverName
      };

      return {
        transfers: [...state.transfers, newTransfer],
        hasHadTransfers: true,
        indicatorDismissed: false
      };
    }),

  addReceivedRecording: (recording) =>
    set((state) => ({
      receivedRecordings: [...state.receivedRecordings, recording]
    })),

  clearReceivedRecordings: () => set({ receivedRecordings: [] }),

  isTransferring: () => {
    const { transfers } = get();
    return transfers.some((t) => t.status === 'pending' || t.status === 'active');
  },

  setIndicatorDismissed: (dismissed) => set({ indicatorDismissed: dismissed }),

  reset: () =>
    set({
      transfers: [],
      receivedRecordings: [],
      indicatorDismissed: false,
      hasHadTransfers: false
    }),

  simulateRace: (durationMs = 5000) => {
    // Create fake transfers for "You" and an opponent
    const youId = 'sim-you-' + Date.now();
    const opponentId = 'sim-opponent-' + Date.now();
    const transferIdYou = 'sim-transfer-you-' + Date.now();
    const transferIdOpponent = 'sim-transfer-opponent-' + Date.now();

    const youTransfer: Transfer = {
      id: transferIdYou,
      peerId: 'sim-receiver',
      peerName: 'Receiver',
      filename: 'recording.webm',
      size: 50000000,
      progress: 0,
      status: 'active',
      direction: 'send',
      role: 'sender',
      senderId: youId,
      senderName: 'You',
      receiverId: 'sim-receiver',
      receiverName: 'Receiver'
    };

    const opponentTransfer: Transfer = {
      id: transferIdOpponent,
      peerId: opponentId,
      peerName: 'Rival Samurai',
      filename: 'recording.webm',
      size: 50000000,
      progress: 0,
      status: 'active',
      direction: 'receive',
      role: 'observer',
      senderId: opponentId,
      senderName: 'Rival Samurai',
      receiverId: 'sim-receiver-2',
      receiverName: 'Another Receiver'
    };

    set({
      transfers: [youTransfer, opponentTransfer],
      hasHadTransfers: true,
      indicatorDismissed: false
    });

    // Animate progress over duration
    const startTime = Date.now();
    const interval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const baseProgress = Math.min(elapsed / durationMs, 1);

      // Add some variation - opponent slightly slower
      const youProgress = Math.min(baseProgress * 1.05, 1);
      const opponentProgress = Math.min(baseProgress * 0.92, 1);

      set((state) => ({
        transfers: state.transfers.map((t) => {
          if (t.id === transferIdYou) {
            return {
              ...t,
              progress: youProgress,
              status: youProgress >= 1 ? 'complete' : 'active'
            };
          }
          if (t.id === transferIdOpponent) {
            return {
              ...t,
              progress: opponentProgress,
              status: opponentProgress >= 1 ? 'complete' : 'active'
            };
          }
          return t;
        })
      }));

      if (baseProgress >= 1) {
        clearInterval(interval);
        // Mark both as complete after a small delay
        setTimeout(() => {
          set((state) => ({
            transfers: state.transfers.map((t) =>
              t.id === transferIdYou || t.id === transferIdOpponent
                ? { ...t, progress: 1, status: 'complete' }
                : t
            )
          }));
        }, 500);
      }
    }, 50);
  }
}));

// Expose store for E2E testing
if (typeof window !== 'undefined') {
  (window as unknown as { __transferStore__: typeof useTransferStore }).__transferStore__ =
    useTransferStore;
}
