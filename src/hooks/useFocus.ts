import { useCallback } from 'react';
import { useSessionStore } from '../store/sessionStore';
import { usePeerManager } from './usePeerManager';

export function useFocus() {
  const { focusedPeerId } = useSessionStore();
  const { broadcastFocusChange } = usePeerManager();

  const changeFocus = useCallback(
    (peerId: string | null) => {
      // broadcastFocusChange updates local state and broadcasts to peers
      broadcastFocusChange(peerId);
    },
    [broadcastFocusChange]
  );

  return { focusedPeerId, changeFocus };
}
