import { useCallback, useEffect, useRef } from 'react';
import { type Room } from 'trystero/torrent';
import { useSessionStore } from '../store/sessionStore';
import { focusService } from '../services/p2p/FocusService';

export function useFocus(room?: Room) {
  const { focusedPeerId, setFocusedPeerId } = useSessionStore();
  const initializedRef = useRef(false);

  useEffect(() => {
    if (room && !initializedRef.current) {
      initializedRef.current = true;
      focusService.initialize(room);

      // Listen for focus changes from other peers
      focusService.onFocusChange((peerId) => {
        setFocusedPeerId(peerId);
      });
    }

    return () => {
      if (initializedRef.current) {
        focusService.clear();
        initializedRef.current = false;
      }
    };
  }, [room, setFocusedPeerId]);

  const changeFocus = useCallback(
    (peerId: string | null) => {
      // Update local state immediately
      setFocusedPeerId(peerId);
      // Broadcast to other peers
      focusService.broadcastFocusChange(peerId);
    },
    [setFocusedPeerId]
  );

  return { focusedPeerId, changeFocus };
}
