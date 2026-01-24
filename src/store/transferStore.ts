import { create } from 'zustand';

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
}

interface TransferState {
  transfers: Transfer[];
  receivedRecordings: ReceivedRecording[];

  setTransfers: (transfers: Transfer[]) => void;
  addTransfer: (transfer: Transfer) => void;
  updateTransfer: (id: string, updates: Partial<Transfer>) => void;
  removeTransfer: (id: string) => void;
  clearTransfers: () => void;

  addReceivedRecording: (recording: ReceivedRecording) => void;
  clearReceivedRecordings: () => void;

  isTransferring: () => boolean;
}

export const useTransferStore = create<TransferState>((set, get) => ({
  transfers: [],
  receivedRecordings: [],

  setTransfers: (transfers) => set({ transfers }),

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
  }
}));
