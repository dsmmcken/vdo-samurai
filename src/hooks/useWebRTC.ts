import { useCallback, useEffect } from 'react';
import { useSessionStore } from '../store/sessionStore';
import { generateRoomCode } from '../utils/roomCode';
import { usePeerStore } from '../store/peerStore';
import { useTrystero } from '../contexts/TrysteroContext';
import { usePeerManager } from './usePeerManager';
import { saveConnection } from '../services/storage/connectionHistory';
import { toast } from '../components/ui/toastStore';

export function useWebRTC() {
  const {
    sessionId,
    isHost,
    localStream,
    setSessionId,
    setIsHost,
    setUserName,
    setIsConnecting,
    setIsConnected,
    setError,
    reset
  } = useSessionStore();

  const { clearPeers } = usePeerStore();
  const { joinSession: trysteroJoin, leaveSession: trysteroLeave, isConnected: trysteroConnected } = useTrystero();

  // Get peer manager methods from context
  const peerManager = usePeerManager();

  const createSession = useCallback(
    async (name: string, existingSessionId?: string) => {
      const newSessionId = existingSessionId || generateRoomCode();
      setIsConnecting(true);
      setError(null);

      try {
        trysteroJoin(newSessionId);
        setUserName(name);
        setSessionId(newSessionId);
        setIsHost(true);
        setIsConnected(true);

        saveConnection({
          sessionId: newSessionId,
          name,
          timestamp: Date.now(),
          isHost: true
        });

        return newSessionId;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to create session';
        setError(message);
        toast.error('Failed to create session', message);
        throw err;
      } finally {
        setIsConnecting(false);
      }
    },
    [trysteroJoin, setSessionId, setIsHost, setUserName, setIsConnecting, setIsConnected, setError]
  );

  const joinSession = useCallback(
    async (existingSessionId: string, name: string) => {
      setIsConnecting(true);
      setError(null);

      try {
        trysteroJoin(existingSessionId);
        setUserName(name);
        setSessionId(existingSessionId);
        setIsHost(false);
        setIsConnected(true);

        saveConnection({
          sessionId: existingSessionId,
          name,
          timestamp: Date.now(),
          isHost: false
        });

        return existingSessionId;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to join session';
        setError(message);
        toast.error('Failed to join session', message);
        throw err;
      } finally {
        setIsConnecting(false);
      }
    },
    [trysteroJoin, setSessionId, setIsHost, setUserName, setIsConnecting, setIsConnected, setError]
  );

  const leaveSession = useCallback(() => {
    // Reset session state first to ensure UI updates immediately
    clearPeers();
    reset();
    // Then clean up trystero
    trysteroLeave();
  }, [clearPeers, reset, trysteroLeave]);

  // Add local stream to peers when it becomes available
  useEffect(() => {
    if (localStream && trysteroConnected) {
      peerManager.addLocalStream(localStream, { type: 'camera' });
    }
  }, [localStream, trysteroConnected, peerManager]);

  // NOTE: No cleanup on unmount - session persists until explicit leaveSession call
  // This prevents React StrictMode double-mount from breaking the connection

  return {
    sessionId,
    isHost,
    createSession,
    joinSession,
    leaveSession,
    addStream: peerManager.addLocalStream,
    removeStream: peerManager.removeLocalStream
  };
}
