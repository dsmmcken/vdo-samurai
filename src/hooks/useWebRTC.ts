import { useCallback, useEffect, useRef } from 'react';
import { useSessionStore } from '../store/sessionStore';
import { generateRoomCode } from '../utils/roomCode';
import { usePeerStore } from '../store/peerStore';
import { signalingService, peerManager } from '../services/p2p';
import { saveConnection } from '../services/storage/connectionHistory';
import { toast } from '../components/ui/toastStore';

export function useWebRTC() {
  const {
    sessionId,
    isHost,
    localStream,
    setSessionId,
    setIsHost,
    setIsConnecting,
    setIsConnected,
    setError,
    reset
  } = useSessionStore();

  const { setPeers, clearPeers } = usePeerStore();
  const initializedRef = useRef(false);

  const createSession = useCallback(
    async (name: string, existingSessionId?: string) => {
      const newSessionId = existingSessionId || generateRoomCode();
      setIsConnecting(true);
      setError(null);

      try {
        const room = await signalingService.joinSession(newSessionId);
        peerManager.initialize(room, name, true);
        peerManager.setOnPeersUpdate(setPeers);

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
    [setSessionId, setIsHost, setIsConnecting, setIsConnected, setError, setPeers]
  );

  const joinSession = useCallback(
    async (existingSessionId: string, name: string) => {
      setIsConnecting(true);
      setError(null);

      try {
        const room = await signalingService.joinSession(existingSessionId);
        peerManager.initialize(room, name, false);
        peerManager.setOnPeersUpdate(setPeers);

        setSessionId(existingSessionId);
        setIsHost(false);
        setIsConnected(true);

        saveConnection({
          sessionId: existingSessionId,
          name,
          timestamp: Date.now(),
          isHost: false
        });

        toast.success('Joined session', 'You are now connected');

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
    [setSessionId, setIsHost, setIsConnecting, setIsConnected, setError, setPeers]
  );

  const leaveSession = useCallback(() => {
    // Reset session state first to ensure UI updates immediately
    clearPeers();
    reset();
    // Then clean up signaling and peers
    signalingService.leaveSession();
    peerManager.clear();
  }, [clearPeers, reset]);

  // Add local stream to peers when it becomes available
  useEffect(() => {
    if (localStream && signalingService.isConnected()) {
      peerManager.addLocalStream(localStream, { type: 'camera' });
    }
  }, [localStream]);

  // Cleanup on unmount
  useEffect(() => {
    const wasInitialized = initializedRef.current;
    return () => {
      if (wasInitialized) {
        signalingService.leaveSession();
        peerManager.clear();
      }
    };
  }, []);

  return {
    sessionId,
    isHost,
    createSession,
    joinSession,
    leaveSession,
    addStream: (stream: MediaStream, metadata?: { type: string }) => {
      peerManager.addLocalStream(stream, metadata);
    },
    removeStream: (stream: MediaStream) => {
      peerManager.removeLocalStream(stream);
    }
  };
}
