import { useCallback, useEffect } from 'react';
import { useSessionStore } from '../store/sessionStore';
import { generateRoomCode, parseRoomCode, formatRoomCode } from '../utils/roomCode';
import { usePeerStore } from '../store/peerStore';
import { useTrystero } from '../contexts/TrysteroContext';
import { usePeerManager } from './usePeerManager';
import { saveConnection } from '../services/storage/connectionHistory';
import { toast } from '../components/ui/toastStore';

export function useWebRTC() {
  const {
    sessionId,
    sessionPassword,
    isHost,
    localStream,
    setSessionId,
    setSessionPassword,
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
      // Parse or generate room code with password
      const { roomId, password } = existingSessionId
        ? parseRoomCode(existingSessionId)
        : parseRoomCode(generateRoomCode());

      setIsConnecting(true);
      setError(null);

      try {
        trysteroJoin(roomId, password);
        setUserName(name);
        setSessionId(roomId);
        setSessionPassword(password);
        setIsHost(true);
        setIsConnected(true);

        // Save full code (with password) for reconnection
        const fullCode = formatRoomCode(roomId, password);
        saveConnection({
          sessionId: fullCode,
          name,
          timestamp: Date.now(),
          isHost: true
        });

        return fullCode;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to create session';
        setError(message);
        toast.error('Failed to create session', message);
        throw err;
      } finally {
        setIsConnecting(false);
      }
    },
    [trysteroJoin, setSessionId, setSessionPassword, setIsHost, setUserName, setIsConnecting, setIsConnected, setError]
  );

  const joinSession = useCallback(
    async (existingSessionId: string, name: string) => {
      // Parse room code to get roomId and password
      const { roomId, password } = parseRoomCode(existingSessionId);

      setIsConnecting(true);
      setError(null);

      try {
        trysteroJoin(roomId, password);
        setUserName(name);
        setSessionId(roomId);
        setSessionPassword(password);
        setIsHost(false);
        setIsConnected(true);

        // Save full code (with password) for reconnection
        const fullCode = formatRoomCode(roomId, password);
        saveConnection({
          sessionId: fullCode,
          name,
          timestamp: Date.now(),
          isHost: false
        });

        return fullCode;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to join session';
        setError(message);
        toast.error('Failed to join session', message);
        throw err;
      } finally {
        setIsConnecting(false);
      }
    },
    [trysteroJoin, setSessionId, setSessionPassword, setIsHost, setUserName, setIsConnecting, setIsConnected, setError]
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

  // Get the full shareable code (roomId + password)
  const shareableCode = sessionId && sessionPassword ? formatRoomCode(sessionId, sessionPassword) : null;

  return {
    sessionId,
    sessionPassword,
    shareableCode,
    isHost,
    createSession,
    joinSession,
    leaveSession,
    addStream: peerManager.addLocalStream,
    removeStream: peerManager.removeLocalStream
  };
}
