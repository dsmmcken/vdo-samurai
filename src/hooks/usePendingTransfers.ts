/**
 * Hook for managing pending transfers in browser mode
 * Detects unsent recordings from previous sessions and allows resuming
 */

import { useState, useEffect, useCallback } from 'react';
import { isBrowser } from '../utils/platform';
import {
  getPendingTransfers,
  savePendingTransfer,
  updateTransferStatus,
  deletePendingTransfer,
  clearCompletedTransfers,
  type PendingTransfer
} from '../utils/browserStorage';

export interface UsePendingTransfersReturn {
  pendingTransfers: PendingTransfer[];
  hasPendingTransfers: boolean;
  isLoading: boolean;
  addPendingTransfer: (
    blob: Blob,
    filename: string,
    type: 'camera' | 'screen',
    sessionCode: string,
    userName: string
  ) => Promise<string>;
  markTransferring: (id: string) => Promise<void>;
  markCompleted: (id: string) => Promise<void>;
  removePendingTransfer: (id: string) => Promise<void>;
  downloadPendingTransfer: (id: string) => void;
  refreshPendingTransfers: () => Promise<void>;
}

export function usePendingTransfers(): UsePendingTransfersReturn {
  const [pendingTransfers, setPendingTransfers] = useState<PendingTransfer[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const refreshPendingTransfers = useCallback(async () => {
    if (!isBrowser()) {
      setIsLoading(false);
      return;
    }

    try {
      const transfers = await getPendingTransfers();
      setPendingTransfers(transfers);
    } catch (err) {
      console.error('[usePendingTransfers] Failed to load pending transfers:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Load pending transfers on mount
  useEffect(() => {
    refreshPendingTransfers();
  }, [refreshPendingTransfers]);

  // Clean up completed transfers periodically
  useEffect(() => {
    if (!isBrowser()) return;

    const cleanup = async () => {
      try {
        await clearCompletedTransfers();
      } catch (err) {
        console.error('[usePendingTransfers] Failed to clear completed transfers:', err);
      }
    };

    // Clean up on mount
    cleanup();

    // And periodically (every 5 minutes)
    const interval = setInterval(cleanup, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  const addPendingTransfer = useCallback(
    async (
      blob: Blob,
      filename: string,
      type: 'camera' | 'screen',
      sessionCode: string,
      userName: string
    ): Promise<string> => {
      const id = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

      const transfer: PendingTransfer = {
        id,
        blob,
        filename,
        type,
        sessionCode,
        userName,
        createdAt: Date.now(),
        status: 'pending'
      };

      await savePendingTransfer(transfer);
      setPendingTransfers((prev) => [...prev, transfer]);

      console.log(`[usePendingTransfers] Added pending transfer: ${id}`);
      return id;
    },
    []
  );

  const markTransferring = useCallback(async (id: string) => {
    await updateTransferStatus(id, 'transferring');
    setPendingTransfers((prev) =>
      prev.map((t) => (t.id === id ? { ...t, status: 'transferring' as const } : t))
    );
  }, []);

  const markCompleted = useCallback(async (id: string) => {
    await updateTransferStatus(id, 'completed');
    // Remove from local state immediately
    setPendingTransfers((prev) => prev.filter((t) => t.id !== id));
    // Also delete from IndexedDB
    await deletePendingTransfer(id);
    console.log(`[usePendingTransfers] Transfer completed and removed: ${id}`);
  }, []);

  const removePendingTransfer = useCallback(async (id: string) => {
    await deletePendingTransfer(id);
    setPendingTransfers((prev) => prev.filter((t) => t.id !== id));
    console.log(`[usePendingTransfers] Removed pending transfer: ${id}`);
  }, []);

  const downloadPendingTransfer = useCallback((id: string) => {
    const transfer = pendingTransfers.find((t) => t.id === id);
    if (!transfer) {
      console.error(`[usePendingTransfers] Transfer not found: ${id}`);
      return;
    }

    // Create download link
    const url = URL.createObjectURL(transfer.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = transfer.filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    console.log(`[usePendingTransfers] Downloaded: ${transfer.filename}`);
  }, [pendingTransfers]);

  return {
    pendingTransfers,
    hasPendingTransfers: pendingTransfers.length > 0,
    isLoading,
    addPendingTransfer,
    markTransferring,
    markCompleted,
    removePendingTransfer,
    downloadPendingTransfer,
    refreshPendingTransfers
  };
}
