import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useSessionStore } from '../store/sessionStore';
import { useRecordingStore } from '../store/recordingStore';
import { useNLEStore, type NLEClip } from '../store/nleStore';
import { usePeerStore } from '../store/peerStore';
import { useTransferStore } from '../store/transferStore';
import { useWebRTC } from '../hooks/useWebRTC';
import { useMediaStream } from '../hooks/useMediaStream';
import { useTrystero } from '../contexts/TrysteroContext';
import { ScreenShareButton } from '../components/video/ScreenShareButton';
import { SpeedDialButton, SpeedDialPanel } from '../components/speeddial';
import { isElectron } from '../utils/platform';
import { useRecording } from '../hooks/useRecording';
import { useEditPoints } from '../hooks/useEditPoints';
import { useFileTransfer } from '../hooks/useFileTransfer';
import { usePendingTransfers } from '../hooks/usePendingTransfers';
import { MainDisplay } from '../components/video/MainDisplay';
import { TileGrid } from '../components/video/TileGrid';
import { RecordButton } from '../components/recording/RecordButton';
import { CountdownOverlay } from '../components/recording/CountdownOverlay';
import { NLEEditor } from '../components/nle';
import { useUserStore } from '../store/userStore';
import { getColorForName } from '../utils/colorHash';
import { isBrowser } from '../utils/platform';

const LAST_SESSION_KEY = 'vdo-samurai-last-session';

interface LastSession {
  roomCode: string;
  wasHost: boolean;
}

function getLastSession(): LastSession | null {
  try {
    const stored = localStorage.getItem(LAST_SESSION_KEY);
    return stored ? JSON.parse(stored) : null;
  } catch {
    return null;
  }
}

export function SessionPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  // Combine sessionId with password from URL query params to form full room code
  const fullRoomCode = useMemo(() => {
    const password = searchParams.get('p');
    if (password && sessionId) {
      return `${sessionId}?p=${password}`;
    }
    return sessionId || '';
  }, [sessionId, searchParams]);
  const { isConnected, isConnecting, isHost, localStream } = useSessionStore();
  const { localBlob, localScreenBlob, editPoints, startTime, endTime } = useRecordingStore();
  const { mode, setMode, initializeClips } = useNLEStore();
  const { peers } = usePeerStore();
  const { receivedRecordings } = useTransferStore();
  const { createSession, joinSession } = useWebRTC();
  const {
    requestStream,
    toggleVideo,
    toggleVideoFull,
    toggleAudio,
    getAudioOnlyStream,
    setOnVideoTrackEnded
  } = useMediaStream();
  const { broadcastVideoState } = useTrystero();
  const { profile } = useUserStore();
  const reconnectAttemptedRef = useRef(false);
  const recordButtonRef = useRef<HTMLButtonElement>(null);
  const wasRecordingRef = useRef(false);

  // Mark reconnect as attempted when connected (prevents auto-reconnect after manual leave)
  useEffect(() => {
    if (isConnected) {
      reconnectAttemptedRef.current = true;
    }
  }, [isConnected]);

  // Auto-reconnect on page refresh
  useEffect(() => {
    if (reconnectAttemptedRef.current) return;
    if (isConnected || isConnecting || !fullRoomCode || !profile?.displayName) return;

    reconnectAttemptedRef.current = true;

    const reconnect = async () => {
      try {
        const lastSession = getLastSession();
        // Check if this session matches the last session (compare full room codes)
        const wasHost = lastSession?.roomCode === fullRoomCode && lastSession?.wasHost;

        // Request media access first
        await requestStream();

        if (wasHost) {
          // Rejoin as host
          await createSession(profile.displayName, fullRoomCode);
        } else {
          // Join as participant
          await joinSession(fullRoomCode, profile.displayName);
        }
      } catch (err) {
        console.error('[SessionPage] Failed to reconnect:', err);
        navigate('/');
      }
    };

    reconnect();
  }, [
    fullRoomCode,
    isConnected,
    isConnecting,
    profile,
    requestStream,
    createSession,
    joinSession,
    navigate
  ]);

  // Ensure local stream is available when connected
  useEffect(() => {
    console.log(
      '[SessionPage] Stream effect - isConnected:',
      isConnected,
      'localStream:',
      !!localStream
    );
    if (isConnected && !localStream) {
      console.log('[SessionPage] Requesting camera stream...');
      requestStream().catch((err) => {
        console.error('[SessionPage] Failed to get camera stream:', err);
      });
    }
  }, [isConnected, localStream, requestStream]);

  const {
    isRecording,
    countdown,
    startRecording,
    stopRecording,
    onVideoEnabled,
    onVideoDisabled,
    onScreenShareStarted,
    onScreenShareEnded
  } = useRecording({
    setOnVideoTrackEnded,
    getAudioOnlyStream
  });
  const { sendMultipleToAllPeers } = useFileTransfer();
  const { addPendingTransfer, markCompleted } = usePendingTransfers();

  const browserMode = isBrowser();

  // Initialize edit points tracking
  useEditPoints();

  const [videoEnabled, setVideoEnabled] = useState(true);
  const [audioEnabled, setAudioEnabled] = useState(true);

  // Track when recording starts so we know when it stops
  useEffect(() => {
    if (isRecording) {
      wasRecordingRef.current = true;
    }
  }, [isRecording]);

  // Track if recordings have been sent to prevent duplicate sends
  const recordingsSentRef = useRef(false);
  // Track pending transfer IDs to mark complete when P2P transfer finishes
  const pendingTransferIdsRef = useRef<Map<string, string>>(new Map());

  // When recording stops and we're NOT the host, send recordings to host
  // We use a flag to ensure recordings are only sent once, after both blobs are ready
  // or after a short delay to ensure the screen blob has time to be set
  useEffect(() => {
    if (!localBlob || isHost || recordingsSentRef.current) return;

    // If screen recording was active, wait for the screen blob to be available
    // The screen blob is set asynchronously after the camera blob
    const sendRecordings = async () => {
      if (recordingsSentRef.current) return;
      recordingsSentRef.current = true;

      const recordings: Array<{ blob: Blob; type: 'camera' | 'screen' }> = [
        { blob: localBlob, type: 'camera' }
      ];
      if (localScreenBlob) {
        recordings.push({ blob: localScreenBlob, type: 'screen' });
        console.log('[SessionPage] Sending camera and screen recordings');
      } else {
        console.log('[SessionPage] Sending camera recording only (no screen blob)');
      }

      // In browser mode, save recordings to IndexedDB first for persistence
      // This ensures recordings survive browser crashes/closes
      if (browserMode && fullRoomCode && profile?.displayName) {
        for (const rec of recordings) {
          try {
            const filename = `${rec.type}-recording-${Date.now()}.webm`;
            const pendingId = await addPendingTransfer(
              rec.blob,
              filename,
              rec.type,
              fullRoomCode,
              profile.displayName
            );
            // Store mapping to mark complete when P2P finishes
            pendingTransferIdsRef.current.set(`${rec.type}`, pendingId);
            console.log(`[SessionPage] Saved ${rec.type} recording to IndexedDB: ${pendingId}`);
          } catch (err) {
            console.error(`[SessionPage] Failed to save ${rec.type} to IndexedDB:`, err);
          }
        }
      }

      // Start P2P transfer
      sendMultipleToAllPeers(recordings);
    };

    // If we already have both blobs, send immediately
    if (localScreenBlob) {
      sendRecordings();
      return;
    }

    // Otherwise, wait a short time for the screen blob to be set
    // This handles the async timing between camera and screen blob being set
    const timeoutId = setTimeout(async () => {
      // Check again if screen blob is now available
      // We need to read from the store directly to get the latest value
      const currentState = useRecordingStore.getState();
      if (currentState.localScreenBlob) {
        // Use the current screen blob from the store
        recordingsSentRef.current = true;
        const recordings: Array<{ blob: Blob; type: 'camera' | 'screen' }> = [
          { blob: localBlob, type: 'camera' },
          { blob: currentState.localScreenBlob, type: 'screen' }
        ];

        // Save to IndexedDB in browser mode
        if (browserMode && fullRoomCode && profile?.displayName) {
          for (const rec of recordings) {
            try {
              const filename = `${rec.type}-recording-${Date.now()}.webm`;
              const pendingId = await addPendingTransfer(
                rec.blob,
                filename,
                rec.type,
                fullRoomCode,
                profile.displayName
              );
              pendingTransferIdsRef.current.set(`${rec.type}`, pendingId);
              console.log(`[SessionPage] Saved ${rec.type} recording to IndexedDB: ${pendingId}`);
            } catch (err) {
              console.error(`[SessionPage] Failed to save ${rec.type} to IndexedDB:`, err);
            }
          }
        }

        console.log('[SessionPage] Sending camera and screen recordings (after delay)');
        sendMultipleToAllPeers(recordings);
      } else {
        // No screen blob available, just send camera
        sendRecordings();
      }
    }, 500); // Wait 500ms for screen blob to be set

    return () => clearTimeout(timeoutId);
  }, [
    localBlob,
    localScreenBlob,
    isHost,
    sendMultipleToAllPeers,
    browserMode,
    fullRoomCode,
    profile,
    addPendingTransfer
  ]);

  // Reset the sent flag when recording starts
  useEffect(() => {
    if (isRecording) {
      recordingsSentRef.current = false;
      pendingTransferIdsRef.current.clear();
    }
  }, [isRecording]);

  // Watch for transfer completion and mark pending transfers as complete (browser mode only)
  const { transfers } = useTransferStore();
  useEffect(() => {
    if (!browserMode || pendingTransferIdsRef.current.size === 0) return;

    // Check if any of our transfers completed
    for (const transfer of transfers) {
      if (transfer.status === 'complete') {
        // Check if this was a camera or screen recording we sent
        // The transfer filename includes the type
        const type = transfer.filename.includes('camera') ? 'camera' : 'screen';
        const pendingId = pendingTransferIdsRef.current.get(type);
        if (pendingId) {
          console.log(
            `[SessionPage] P2P transfer completed, marking pending transfer done: ${pendingId}`
          );
          markCompleted(pendingId).catch((err) => {
            console.error('[SessionPage] Failed to mark pending transfer complete:', err);
          });
          pendingTransferIdsRef.current.delete(type);
        }
      }
    }
  }, [transfers, browserMode, markCompleted]);

  // Initialize clips from editPoints for NLE editor
  const initializeNLEClips = useCallback(() => {
    if (!startTime) return;

    // Calculate recording duration - use endTime if available, otherwise estimate from timestamps
    const recordingEndTime = endTime || Date.now();
    const recordingDuration = Math.max(0, recordingEndTime - startTime);

    const clips: NLEClip[] = [];
    let clipOrder = 0;

    // Convert edit points to clips
    // Each focus-change creates a boundary for the next clip
    if (editPoints.length > 0) {
      for (let i = 0; i < editPoints.length; i++) {
        const point = editPoints[i];
        const nextPoint = editPoints[i + 1];

        if (point.type !== 'focus-change') continue;

        const clipStartTime = Math.max(0, point.timestamp);
        const clipEndTime = nextPoint
          ? Math.max(clipStartTime, nextPoint.timestamp)
          : recordingDuration;

        // Skip clips with no duration
        if (clipEndTime <= clipStartTime) continue;

        // Determine peer info
        // IMPORTANT: Always use focusedPeerId directly, even if peer has disconnected
        // This ensures received recordings can be matched by peerId
        let peerId: string | null = null;
        let peerName = profile?.displayName || 'You';

        if (point.focusedPeerId) {
          // Always use the focusedPeerId - this is critical for matching with received recordings
          peerId = point.focusedPeerId;

          // Try to find the peer name from multiple sources
          // 1. First check if peer is still connected
          const connectedPeer = peers.find((p) => p.id === point.focusedPeerId);
          if (connectedPeer) {
            peerName = connectedPeer.name;
          } else {
            // 2. Fall back to name from received recordings
            const receivedRecording = receivedRecordings.find(
              (r) => r.peerId === point.focusedPeerId
            );
            if (receivedRecording) {
              peerName = receivedRecording.peerName;
            } else {
              // 3. Final fallback: use peer ID prefix
              peerName = `Peer-${point.focusedPeerId.slice(0, 4)}`;
            }
          }
        }

        clips.push({
          id: `clip-${clipOrder}`,
          peerId,
          peerName,
          startTime: clipStartTime,
          endTime: clipEndTime,
          order: clipOrder,
          trimStart: 0,
          trimEnd: 0,
          color: getColorForName(peerName),
          sourceType: 'camera'
        });

        clipOrder++;
      }
    }

    // If no clips were created from edit points, create a single clip for local recording
    if (clips.length === 0 && localBlob && recordingDuration > 0) {
      clips.push({
        id: 'clip-0',
        peerId: null,
        peerName: profile?.displayName || 'You',
        startTime: 0,
        endTime: recordingDuration,
        order: 0,
        trimStart: 0,
        trimEnd: 0,
        color: getColorForName(profile?.displayName || 'You'),
        sourceType: 'camera'
      });
    }

    initializeClips(clips);
  }, [
    editPoints,
    startTime,
    endTime,
    peers,
    receivedRecordings,
    profile,
    localBlob,
    initializeClips
  ]);

  // When recording stops and host has a blob, go straight to editor
  // Only if we actually recorded in this session (wasRecordingRef is true)
  useEffect(() => {
    if (localBlob && isHost && wasRecordingRef.current && !isRecording) {
      // Reset the flag so it doesn't trigger again
      wasRecordingRef.current = false;
      // Go straight to editor instead of showing popover
      initializeNLEClips();
      setMode('editing');
    }
  }, [localBlob, isHost, isRecording, initializeNLEClips, setMode]);

  const handleCloseEditor = useCallback(() => {
    setMode('session');
  }, [setMode]);

  const handleToggleVideo = useCallback(async () => {
    if (isRecording) {
      // During recording: use full toggle that releases camera and manages clips
      const wasEnabled = videoEnabled;

      if (wasEnabled) {
        // Video ON -> OFF: Stop video clip, start audio-only clip
        const enabled = await toggleVideoFull({
          onBeforeVideoOff: async () => {
            await onVideoDisabled(getAudioOnlyStream);
          }
        });
        setVideoEnabled(enabled);
        broadcastVideoState(enabled, audioEnabled);
      } else {
        // Video OFF -> ON: Stop audio-only clip, start video clip
        const enabled = await toggleVideoFull({
          onAfterVideoOn: async () => {
            await onVideoEnabled();
          }
        });
        setVideoEnabled(enabled);
        broadcastVideoState(enabled, audioEnabled);
      }
    } else {
      // Not recording: simple mute toggle (legacy behavior)
      const enabled = toggleVideo();
      setVideoEnabled(enabled);
      broadcastVideoState(enabled, audioEnabled);
    }
  }, [
    isRecording,
    videoEnabled,
    audioEnabled,
    toggleVideo,
    toggleVideoFull,
    onVideoEnabled,
    onVideoDisabled,
    getAudioOnlyStream,
    broadcastVideoState
  ]);

  const handleToggleAudio = useCallback(() => {
    const enabled = toggleAudio();
    setAudioEnabled(enabled);
    broadcastVideoState(videoEnabled, enabled);
  }, [toggleAudio, videoEnabled, broadcastVideoState]);

  // If not connected and we have a session ID, auto-reconnect is in progress
  if (!isConnected && !isConnecting && sessionId) {
    // Check if we have a profile - if not, redirect to home
    if (!profile?.displayName) {
      navigate('/');
      return null;
    }
    // Show reconnecting state while auto-reconnect happens
    return (
      <div className="h-full bg-black flex items-center justify-center">
        <div className="text-center">
          <svg
            className="animate-spin h-12 w-12 mx-auto mb-4 text-[--color-primary]"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
              fill="none"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
          <p className="text-gray-400">Reconnecting to session...</p>
        </div>
      </div>
    );
  }

  // Show loading while connecting
  if (isConnecting) {
    return (
      <div className="h-full bg-black flex items-center justify-center">
        <div className="text-center">
          <svg
            className="animate-spin h-12 w-12 mx-auto mb-4 text-[--color-primary]"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
              fill="none"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
          <p className="text-gray-400">Connecting to session...</p>
        </div>
      </div>
    );
  }

  // Show NLE editor when in editing mode
  if (mode === 'editing') {
    return (
      <div className="h-full bg-black flex flex-col overflow-hidden">
        <div className="flex-1 min-h-0">
          <NLEEditor onClose={handleCloseEditor} />
        </div>

        {/* Participant tiles - still visible in editing mode */}
        <div className="flex-shrink-0 px-2 sm:px-3 pb-2 sm:pb-3">
          <TileGrid />
        </div>
      </div>
    );
  }

  return (
    <div className="h-full bg-black flex flex-col overflow-hidden">
      {/* Countdown overlay */}
      <CountdownOverlay countdown={countdown} />

      {/* Main video display with overlaid controls */}
      <div className="flex-1 min-h-0 p-2 sm:p-3 pb-1 video-container relative">
        <MainDisplay>
          {/* Controls - anchored to video via CSS anchor positioning */}
          <div
            className="flex items-center justify-center gap-1 sm:gap-2 relative"
            role="toolbar"
            aria-label="Session controls"
          >
            {/* Video toggle */}
            <button
              onClick={handleToggleVideo}
              className={`p-2 sm:p-3 rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black ${
                videoEnabled
                  ? 'bg-black/50 hover:bg-black/70 text-white'
                  : 'bg-red-500/70 hover:bg-red-500/90 text-white'
              }`}
              aria-label={videoEnabled ? 'Turn off camera' : 'Turn on camera'}
              aria-pressed={videoEnabled}
              title={videoEnabled ? 'Turn off camera' : 'Turn on camera'}
            >
              {videoEnabled ? (
                <svg
                  className="w-5 h-5 sm:w-6 sm:h-6"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
                  />
                </svg>
              ) : (
                <svg
                  className="w-5 h-5 sm:w-6 sm:h-6"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"
                  />
                </svg>
              )}
            </button>

            {/* Audio toggle */}
            <button
              onClick={handleToggleAudio}
              className={`p-2 sm:p-3 rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black ${
                audioEnabled
                  ? 'bg-black/50 hover:bg-black/70 text-white'
                  : 'bg-red-500/70 hover:bg-red-500/90 text-white'
              }`}
              aria-label={audioEnabled ? 'Mute microphone' : 'Unmute microphone'}
              aria-pressed={audioEnabled}
              title={audioEnabled ? 'Mute microphone' : 'Unmute microphone'}
            >
              {audioEnabled ? (
                <svg
                  className="w-5 h-5 sm:w-6 sm:h-6"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"
                  />
                </svg>
              ) : (
                <svg
                  className="w-5 h-5 sm:w-6 sm:h-6"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2"
                  />
                </svg>
              )}
            </button>

            {/* Screen share - hidden on small mobile screens */}
            <div className="hidden sm:block">
              <ScreenShareButton
                onScreenShareStartedDuringRecording={onScreenShareStarted}
                onScreenShareEndedDuringRecording={onScreenShareEnded}
              />
            </div>

            {/* Speed Dial button (host only, Electron only) */}
            {isHost && isElectron() && (
              <div className="hidden sm:block relative">
                <SpeedDialButton />
              </div>
            )}

            {/* Record button (host only) */}
            <RecordButton
              ref={recordButtonRef}
              isRecording={isRecording}
              isHost={isHost}
              countdown={countdown}
              onStart={startRecording}
              onStop={stopRecording}
            />
          </div>
        </MainDisplay>

        {/* Speed Dial Panel (host only, Electron only) */}
        {isHost && isElectron() && <SpeedDialPanel />}
      </div>

      {/* Participant tiles - fixed height row */}
      <div className="flex-shrink-0 px-2 sm:px-3 pb-2 sm:pb-3">
        <TileGrid />
      </div>
    </div>
  );
}
