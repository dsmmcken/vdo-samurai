import { useCallback, useEffect, useRef } from 'react';
import { useSessionStore } from '../store/sessionStore';
import { generateRoomCode, parseRoomCode, formatRoomCode } from '../utils/roomCode';
import { usePeerStore } from '../store/peerStore';
import { useRecordingStore } from '../store/recordingStore';
import { useNLEStore } from '../store/nleStore';
import { useCompositeStore } from '../store/compositeStore';
import { useTransferStore } from '../store/transferStore';
import { useTrystero } from '../contexts/TrysteroContext';
import { usePeerManager } from './usePeerManager';
import { saveConnection } from '../utils/connectionHistory';
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
  const { joinSession: trysteroJoin, leaveSession: trysteroLeave, isConnected: trysteroConnected, broadcastSessionInfo } = useTrystero();
  const { internalSessionId, setInternalSessionId } = useRecordingStore();
  const resetRecording = useRecordingStore((state) => state.reset);
  const resetNLE = useNLEStore((state) => state.reset);
  const resetComposite = useCompositeStore((state) => state.reset);
  const resetTransfer = useTransferStore((state) => state.reset);

  // Get peer manager methods from context
  const peerManager = usePeerManager();

  // Track if we've initialized the internal session for this connection
  const sessionInitializedRef = useRef(false);

  const createSession = useCallback(
    async (name: string, existingSessionId?: string) => {
      // Parse or generate room code with password
      const { roomId, password } = existingSessionId
        ? parseRoomCode(existingSessionId)
        : parseRoomCode(generateRoomCode());

      setIsConnecting(true);
      setError(null);

      try {
        // Reset session initialization flag for new connection
        sessionInitializedRef.current = false;

        trysteroJoin(roomId, password);
        setUserName(name);
        setSessionId(roomId);
        setSessionPassword(password);
        setIsHost(true);
        setIsConnected(true);

        // Host creating a new session - generate new internal session ID
        // Reset all recording/edit state for fresh start
        resetRecording();
        resetNLE();
        resetComposite();
        resetTransfer();

        const newInternalSessionId = crypto.randomUUID();
        setInternalSessionId(newInternalSessionId);
        sessionInitializedRef.current = true;
        console.log('[useWebRTC] Created new internal session:', newInternalSessionId);

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
    [trysteroJoin, setSessionId, setSessionPassword, setIsHost, setUserName, setIsConnecting, setIsConnected, setError, resetRecording, resetNLE, resetComposite, resetTransfer, setInternalSessionId]
  );

  const joinSession = useCallback(
    async (existingSessionId: string, name: string) => {
      // Parse room code to get roomId and password
      const { roomId, password } = parseRoomCode(existingSessionId);

      setIsConnecting(true);
      setError(null);

      try {
        // Reset session initialization flag for new connection
        sessionInitializedRef.current = false;

        trysteroJoin(roomId, password);
        setUserName(name);
        setSessionId(roomId);
        setSessionPassword(password);
        setIsHost(false);
        setIsConnected(true);

        // Non-host joining - will receive session-info from existing peers
        // The TrysteroContext handles receiving and applying the session ID
        // If no peers are present (empty room), we'll initialize our own session
        console.log('[useWebRTC] Joining session, will wait for session-info from peers');

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
    // Reset all recording/edit state
    resetRecording();
    resetNLE();
    resetComposite();
    resetTransfer();
    // Reset session initialization flag
    sessionInitializedRef.current = false;
    // Then clean up trystero
    trysteroLeave();
  }, [clearPeers, reset, resetRecording, resetNLE, resetComposite, resetTransfer, trysteroLeave]);

  // Add local stream to peers when it becomes available
  useEffect(() => {
    if (localStream && trysteroConnected) {
      peerManager.addLocalStream(localStream, { type: 'camera' });
    }
  }, [localStream, trysteroConnected, peerManager]);

  // Handle session initialization for non-hosts joining empty rooms
  // If connected but no internal session ID after a delay (no peers sent us one),
  // initialize our own session
  useEffect(() => {
    if (!trysteroConnected || sessionInitializedRef.current || internalSessionId) {
      return;
    }

    // Give time for peers to send us their session info
    const timeout = setTimeout(() => {
      // Double-check we still don't have a session ID
      const currentInternalSessionId = useRecordingStore.getState().internalSessionId;
      if (!currentInternalSessionId && !sessionInitializedRef.current) {
        // No peers sent us a session ID - we're likely the first in the room
        // Reset all recording/edit state and create new session
        console.log('[useWebRTC] No session info received from peers, initializing new session');
        resetRecording();
        resetNLE();
        resetComposite();
        resetTransfer();

        const newInternalSessionId = crypto.randomUUID();
        setInternalSessionId(newInternalSessionId);
        sessionInitializedRef.current = true;

        // Broadcast to any peers that might join later
        broadcastSessionInfo(newInternalSessionId);
      }
    }, 3000); // Wait 3 seconds for peers to respond

    return () => clearTimeout(timeout);
  }, [trysteroConnected, internalSessionId, resetRecording, resetNLE, resetComposite, resetTransfer, setInternalSessionId, broadcastSessionInfo]);

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
