import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useSessionStore } from '../store/sessionStore';
import { useRecordingStore } from '../store/recordingStore';
import { useNLEStore, type NLEClip } from '../store/nleStore';
import { usePopoverStore } from '../store/popoverStore';
import { usePeerStore } from '../store/peerStore';
import { useWebRTC } from '../hooks/useWebRTC';
import { useMediaStream } from '../hooks/useMediaStream';
import { ScreenShareButton } from '../components/video/ScreenShareButton';
import { useRecording } from '../hooks/useRecording';
import { useEditPoints } from '../hooks/useEditPoints';
import { useFileTransfer } from '../hooks/useFileTransfer';
import { MainDisplay } from '../components/video/MainDisplay';
import { TileGrid } from '../components/video/TileGrid';
import { RecordButton } from '../components/recording/RecordButton';
import { RecordingCompletePopover } from '../components/recording/RecordingCompletePopover';
import { CountdownOverlay } from '../components/recording/CountdownOverlay';
import { NLEEditor } from '../components/nle';
import { useUserStore } from '../store/userStore';
import { getColorForName } from '../utils/colorHash';

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
  const navigate = useNavigate();
  const { isConnected, isConnecting, isHost, localStream } = useSessionStore();
  const { localBlob, localScreenBlob, editPoints, startTime, endTime } = useRecordingStore();
  const { mode, setMode, initializeClips, reset: resetNLE } = useNLEStore();
  const { openPopover } = usePopoverStore();
  const { peers } = usePeerStore();
  const { createSession, joinSession } = useWebRTC();
  const { requestStream, toggleVideo, toggleAudio } = useMediaStream();
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
    if (isConnected || isConnecting || !sessionId || !profile?.displayName) return;

    reconnectAttemptedRef.current = true;

    const reconnect = async () => {
      try {
        const lastSession = getLastSession();
        const wasHost = lastSession?.roomCode === sessionId && lastSession?.wasHost;

        // Request media access first
        await requestStream();

        if (wasHost) {
          // Rejoin as host
          await createSession(profile.displayName, sessionId);
        } else {
          // Join as participant
          await joinSession(sessionId, profile.displayName);
        }
      } catch (err) {
        console.error('[SessionPage] Failed to reconnect:', err);
        navigate('/');
      }
    };

    reconnect();
  }, [sessionId, isConnected, isConnecting, profile, requestStream, createSession, joinSession, navigate]);

  // Ensure local stream is available when connected
  useEffect(() => {
    console.log('[SessionPage] Stream effect - isConnected:', isConnected, 'localStream:', !!localStream);
    if (isConnected && !localStream) {
      console.log('[SessionPage] Requesting camera stream...');
      requestStream().catch((err) => {
        console.error('[SessionPage] Failed to get camera stream:', err);
      });
    }
  }, [isConnected, localStream, requestStream]);

  const { isRecording, countdown, startRecording, stopRecording } = useRecording();
  const { sendMultipleToAllPeers } = useFileTransfer();

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

  // When recording stops and host has a blob, show the popover
  // Only if we actually recorded in this session (wasRecordingRef is true)
  useEffect(() => {
    if (localBlob && isHost && wasRecordingRef.current && !isRecording) {
      // Reset the flag so it doesn't trigger again
      wasRecordingRef.current = false;
      // Show the recording complete popover
      openPopover('recordingComplete');
    }
  }, [localBlob, isHost, isRecording, openPopover]);

  // When recording stops and we're NOT the host, send recordings to host
  useEffect(() => {
    if (localBlob && !isHost) {
      // Non-host users send their recording(s) to all peers (host will receive them)
      const recordings: Array<{ blob: Blob; type: 'camera' | 'screen' }> = [
        { blob: localBlob, type: 'camera' }
      ];
      if (localScreenBlob) {
        recordings.push({ blob: localScreenBlob, type: 'screen' });
      }
      sendMultipleToAllPeers(recordings);
    }
  }, [localBlob, localScreenBlob, isHost, sendMultipleToAllPeers]);

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

        const clipStartTime = Math.max(0, point.timestamp - startTime);
        const clipEndTime = nextPoint
          ? Math.max(clipStartTime, nextPoint.timestamp - startTime)
          : recordingDuration;

        // Skip clips with no duration
        if (clipEndTime <= clipStartTime) continue;

        // Determine peer info
        let peerId: string | null = null;
        let peerName = profile?.displayName || 'You';

        if (point.focusedPeerId) {
          const peer = peers.find((p) => p.id === point.focusedPeerId);
          if (peer) {
            peerId = peer.id;
            peerName = peer.name;
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
          sourceType: 'camera',
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
        sourceType: 'camera',
      });
    }

    initializeClips(clips);
  }, [editPoints, startTime, endTime, peers, profile, localBlob, initializeClips]);

  const handleBeginTransferAndEdit = useCallback(() => {
    // Initialize clips for NLE
    initializeNLEClips();
    // Switch to editing mode
    setMode('editing');
  }, [initializeNLEClips, setMode]);

  const handleDiscardRecording = useCallback(() => {
    // Reset recording store will be handled elsewhere
    // Just close the popover for now
    resetNLE();
  }, [resetNLE]);

  const handleCloseEditor = useCallback(() => {
    setMode('session');
  }, [setMode]);

  const handleToggleVideo = () => {
    const enabled = toggleVideo();
    setVideoEnabled(enabled);
  };

  const handleToggleAudio = () => {
    const enabled = toggleAudio();
    setAudioEnabled(enabled);
  };

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
      <div className="flex-1 min-h-0 p-2 sm:p-3 pb-1 video-container">
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
          <ScreenShareButton />
        </div>

        {/* Record button (host only) - with popover anchor */}
        <div className="relative">
          <RecordButton
            ref={recordButtonRef}
            isRecording={isRecording}
            isHost={isHost}
            countdown={countdown}
            onStart={startRecording}
            onStop={stopRecording}
          />
          {/* Recording complete popover */}
          <RecordingCompletePopover
            anchorRef={recordButtonRef}
            onBeginTransfer={handleBeginTransferAndEdit}
            onDiscard={handleDiscardRecording}
          />
        </div>
          </div>
        </MainDisplay>
      </div>

      {/* Participant tiles - fixed height row */}
      <div className="flex-shrink-0 px-2 sm:px-3 pb-2 sm:pb-3">
        <TileGrid />
      </div>
    </div>
  );
}
