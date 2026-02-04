import { useCallback } from 'react';
import { useTrystero } from '../contexts/TrysteroContext';
import { usePeerStore } from '../store/peerStore';
import { isElectron } from '../utils/platform';

interface CanMakeHostResult {
  allowed: boolean;
  reason?: string;
}

export function useHostTransfer() {
  const { broadcastHostTransfer } = useTrystero();
  const { peers } = usePeerStore();

  // Check if we can make a specific participant the host
  const canMakeHost = useCallback(
    (targetParticipantId: string): CanMakeHostResult => {
      // Only Electron users can initiate host transfers
      if (!isElectron()) {
        return { allowed: false, reason: 'Only desktop app users can transfer host' };
      }

      // If target is 'self', always allowed (self can become host)
      if (targetParticipantId === 'self') {
        return { allowed: true };
      }

      // Find the target peer
      const targetPeer = peers.find((p) => p.id === targetParticipantId);
      if (!targetPeer) {
        return { allowed: false, reason: 'Participant not found' };
      }

      // Check if target is already the host
      if (targetPeer.isHost) {
        return { allowed: false, reason: 'Already the host' };
      }

      // Check if target is an Electron user
      if (!targetPeer.isElectron) {
        return { allowed: false, reason: 'Browser users cannot become host' };
      }

      return { allowed: true };
    },
    [peers]
  );

  // Make a participant the host
  const makeHost = useCallback(
    (targetParticipantId: string) => {
      const result = canMakeHost(targetParticipantId);
      if (!result.allowed) {
        console.warn('[useHostTransfer] Cannot make host:', result.reason);
        return false;
      }

      console.log('[useHostTransfer] Making host:', targetParticipantId);
      broadcastHostTransfer(targetParticipantId);
      return true;
    },
    [canMakeHost, broadcastHostTransfer]
  );

  // Check if local user is an Electron user (can see context menu options)
  const isLocalElectron = isElectron();

  return { canMakeHost, makeHost, isLocalElectron };
}
