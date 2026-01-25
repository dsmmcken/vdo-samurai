import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useSessionStore } from '../store/sessionStore';
import { useRecordingStore } from '../store/recordingStore';
import { useWebRTC } from '../hooks/useWebRTC';
import { useMediaStream } from '../hooks/useMediaStream';
import { ScreenShareButton } from '../components/video/ScreenShareButton';
import { useRecording } from '../hooks/useRecording';
import { useEditPoints } from '../hooks/useEditPoints';
import { useFileTransfer } from '../hooks/useFileTransfer';
import { signalingService } from '../services/p2p';
import { MainDisplay } from '../components/video/MainDisplay';
import { TileGrid } from '../components/video/TileGrid';
import { RecordButton } from '../components/recording/RecordButton';
import { CountdownOverlay } from '../components/recording/CountdownOverlay';
import { TransferProgress } from '../components/recording/TransferProgress';
import { useUserStore } from '../store/userStore';

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
  const { localBlob } = useRecordingStore();
  const { createSession, joinSession } = useWebRTC();
  const { requestStream, toggleVideo, toggleAudio } = useMediaStream();
  const { profile } = useUserStore();
  const reconnectAttemptedRef = useRef(false);

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

  const room = signalingService.getRoom();
  const { isRecording, countdown, startRecording, stopRecording } = useRecording(
    room ?? undefined
  );
  const { sendToAllPeers } = useFileTransfer(room ?? undefined);

  // Initialize edit points tracking
  useEditPoints();

  const [videoEnabled, setVideoEnabled] = useState(true);
  const [audioEnabled, setAudioEnabled] = useState(true);

  // When recording stops and we have a blob, send it to the host (if not host)
  // or collect from peers (if host)
  useEffect(() => {
    if (localBlob && !isHost) {
      // Non-host users send their recording to all peers (host will receive it)
      sendToAllPeers(localBlob, `recording-${Date.now()}.webm`);
    }
  }, [localBlob, isHost, sendToAllPeers]);

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

  return (
    <div className="h-full bg-black flex flex-col overflow-hidden">
      {/* Countdown overlay */}
      <CountdownOverlay countdown={countdown} />

      {/* Transfer progress */}
      <TransferProgress />

      {/* Main video display with overlaid controls */}
      <div className="flex-1 min-h-0 p-2 sm:p-3 pb-1 video-container">
        <MainDisplay>
          {/* Controls - anchored to video via CSS anchor positioning */}
          <div
            className="flex items-center justify-center gap-1 sm:gap-2"
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

        {/* Record button (host only) */}
        <RecordButton
          isRecording={isRecording}
          isHost={isHost}
          countdown={countdown}
          onStart={startRecording}
          onStop={stopRecording}
        />
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
