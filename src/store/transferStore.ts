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
}

export interface ReceivedRecording {
  peerId: string;
  peerName: string;
  blob: Blob;
  receivedAt: number;
  type: RecordingType;
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

  addReceivedRecording: (recording: ReceivedRecording) => void;
  clearReceivedRecordings: () => void;

  isTransferring: () => boolean;
  setIndicatorDismissed: (dismissed: boolean) => void;
  reset: () => void;
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
      indicatorDismissed: hadTransfers && state.indicatorDismissed && transfers.length <= state.transfers.length
        ? state.indicatorDismissed
        : hadTransfers ? false : state.indicatorDismissed,
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

  reset: () => set({ transfers: [], receivedRecordings: [], indicatorDismissed: false, hasHadTransfers: false })
}));

// Expose store for E2E testing
if (typeof window !== 'undefined') {
  (window as unknown as { __transferStore__: typeof useTransferStore }).__transferStore__ =
    useTransferStore;
}
