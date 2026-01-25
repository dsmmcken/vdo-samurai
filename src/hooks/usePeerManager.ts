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

  return {
    selfId,
    addLocalStream,
    removeLocalStream,
    setActiveScreenShare,
    broadcastFocusChange
  };
}
