import { useMemo } from 'react';
import { useTrystero } from '../contexts/TrysteroContext';

// Simple hook that exposes peer management methods from the context
export function usePeerManager() {
  const {
    selfId,
    addLocalStream,
    removeLocalStream,
    setActiveScreenShare,
    broadcastFocusChange
  } = useTrystero();

  // Memoize the returned object to prevent unnecessary re-renders
  // and effect re-runs in consumers. This is critical to prevent
  // repeated camera stream adds which interfere with WebRTC negotiation.
  return useMemo(
    () => ({
      selfId,
      addLocalStream,
      removeLocalStream,
      setActiveScreenShare,
      broadcastFocusChange
    }),
    [selfId, addLocalStream, removeLocalStream, setActiveScreenShare, broadcastFocusChange]
  );
}
