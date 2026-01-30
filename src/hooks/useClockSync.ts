import { useState, useCallback, useEffect, useRef } from 'react';
import { useTrystero } from '../contexts/TrysteroContext';
import { useSessionStore } from '../store/sessionStore';
import { useRecordingStore } from '../store/recordingStore';
import type { ClockSyncRequestMessage, ClockSyncResponseMessage } from '../types/messages';

const SYNC_SAMPLE_COUNT = 5;
const SYNC_SAMPLE_DELAY = 50; // ms between samples

/**
 * Calculate median of an array of numbers
 */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Sleep helper
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Hook for NTP-style clock synchronization between peers
 *
 * Clock sync is performed:
 * 1. When each peer joins the session
 * 2. Again during the 3-second countdown before recording starts
 */
export function useClockSync() {
  const { room } = useTrystero();
  const { isHost } = useSessionStore();
  const { setClockOffset } = useRecordingStore();
  const [isSynced, setIsSynced] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState<number | null>(null);

  const initializedRef = useRef(false);
  const sendSyncRequestRef = useRef<((data: ClockSyncRequestMessage, peerId?: string) => void) | null>(null);
  const sendSyncResponseRef = useRef<((data: ClockSyncResponseMessage, peerId?: string) => void) | null>(null);
  const pendingSyncResolveRef = useRef<((offset: number) => void) | null>(null);

  // Initialize clock sync actions
  useEffect(() => {
    if (!room || initializedRef.current) return;
    initializedRef.current = true;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [sendSyncRequest, onSyncRequest] = room.makeAction<any>('clk-req');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [sendSyncResponse, onSyncResponse] = room.makeAction<any>('clk-res');

    sendSyncRequestRef.current = sendSyncRequest;
    sendSyncResponseRef.current = sendSyncResponse;

    // Host handles sync requests
    onSyncRequest((data: unknown, peerId: string) => {
      if (!isHost) return;

      const request = data as ClockSyncRequestMessage;
      if (request.type !== 'clock-sync-request') return;

      const serverReceiveTime = Date.now();
      const response: ClockSyncResponseMessage = {
        type: 'clock-sync-response',
        clientSendTime: request.clientSendTime,
        serverReceiveTime,
        serverSendTime: Date.now()
      };

      console.log('[useClockSync] Host responding to sync request from', peerId);
      sendSyncResponse(response, peerId);
    });

    // Non-host handles sync responses
    onSyncResponse((data: unknown) => {
      if (isHost) return;

      const response = data as ClockSyncResponseMessage;
      if (response.type !== 'clock-sync-response') return;

      const clientReceiveTime = Date.now();

      // NTP formula: offset = ((T2 - T1) + (T3 - T4)) / 2
      // T1 = client send time
      // T2 = server receive time
      // T3 = server send time
      // T4 = client receive time
      const offset = ((response.serverReceiveTime - response.clientSendTime) +
                     (response.serverSendTime - clientReceiveTime)) / 2;

      if (pendingSyncResolveRef.current) {
        pendingSyncResolveRef.current(offset);
        pendingSyncResolveRef.current = null;
      }
    });

    return () => {
      initializedRef.current = false;
      sendSyncRequestRef.current = null;
      sendSyncResponseRef.current = null;
    };
  }, [room, isHost]);

  /**
   * Send a single sync request and wait for response
   */
  const sendSingleSyncRequest = useCallback((): Promise<number> => {
    return new Promise((resolve) => {
      if (!sendSyncRequestRef.current) {
        resolve(0);
        return;
      }

      // Set up timeout in case response never comes
      const timeout = setTimeout(() => {
        if (pendingSyncResolveRef.current) {
          pendingSyncResolveRef.current = null;
          resolve(0); // Default to no offset on timeout
        }
      }, 2000);

      pendingSyncResolveRef.current = (offset) => {
        clearTimeout(timeout);
        resolve(offset);
      };

      const request: ClockSyncRequestMessage = {
        type: 'clock-sync-request',
        clientSendTime: Date.now()
      };

      sendSyncRequestRef.current(request);
    });
  }, []);

  /**
   * Perform clock sync with the host
   * Can be called multiple times (on join and before recording)
   * @returns The calculated clock offset in milliseconds
   */
  const syncWithHost = useCallback(async (): Promise<number> => {
    // Host is the reference, offset is always 0
    if (isHost) {
      console.log('[useClockSync] Host is reference, offset = 0');
      setClockOffset(0);
      setIsSynced(true);
      setLastSyncTime(Date.now());
      return 0;
    }

    // Non-host: collect multiple samples
    console.log('[useClockSync] Starting clock sync (collecting', SYNC_SAMPLE_COUNT, 'samples)');
    const offsets: number[] = [];

    for (let i = 0; i < SYNC_SAMPLE_COUNT; i++) {
      const offset = await sendSingleSyncRequest();
      offsets.push(offset);
      console.log(`[useClockSync] Sample ${i + 1}/${SYNC_SAMPLE_COUNT}: offset = ${offset.toFixed(2)}ms`);

      if (i < SYNC_SAMPLE_COUNT - 1) {
        await sleep(SYNC_SAMPLE_DELAY);
      }
    }

    // Use median to filter outliers
    const medianOffset = median(offsets);
    console.log('[useClockSync] Final offset (median):', medianOffset.toFixed(2), 'ms');

    setClockOffset(medianOffset);
    setIsSynced(true);
    setLastSyncTime(Date.now());

    return medianOffset;
  }, [isHost, sendSingleSyncRequest, setClockOffset]);

  /**
   * Reset sync state (e.g., when leaving session)
   */
  const resetSync = useCallback(() => {
    setIsSynced(false);
    setLastSyncTime(null);
    setClockOffset(0);
  }, [setClockOffset]);

  // Auto-sync when joining session (non-host only)
  useEffect(() => {
    if (room && !isHost && !isSynced) {
      // Small delay to ensure connection is stable
      const timer = setTimeout(() => {
        syncWithHost();
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [room, isHost, isSynced, syncWithHost]);

  return {
    syncWithHost,
    isSynced,
    lastSyncTime,
    resetSync
  };
}
