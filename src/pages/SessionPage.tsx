import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useSessionStore } from '../store/sessionStore';
import { useRecordingStore } from '../store/recordingStore';
import { useTransferStore } from '../store/transferStore';
import { useWebRTC } from '../hooks/useWebRTC';
import { useMediaStream } from '../hooks/useMediaStream';
import { ScreenShareButton } from '../components/video/ScreenShareButton';
import { useRecording } from '../hooks/useRecording';
import { useEditPoints } from '../hooks/useEditPoints';
import { useFileTransfer } from '../hooks/useFileTransfer';
import { signalingService } from '../services/p2p';
import { MainDisplay } from '../components/video/MainDisplay';
import { TileGrid } from '../components/video/TileGrid';
import { JoinSession } from '../components/connection/JoinSession';
import { RecordButton } from '../components/recording/RecordButton';
import { CountdownOverlay } from '../components/recording/CountdownOverlay';
import { OnAirIndicator } from '../components/recording/OnAirIndicator';
import { TransferProgress } from '../components/recording/TransferProgress';

export function SessionPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const { isConnected, isConnecting, isHost, localStream } = useSessionStore();
  const { localBlob } = useRecordingStore();
  const { isTransferring } = useTransferStore();
  const { leaveSession } = useWebRTC();
  const { requestStream, stopStream, toggleVideo, toggleAudio } = useMediaStream();

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
  const { isRecording, countdown, startTime, startRecording, stopRecording } = useRecording(
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

  const handleLeave = () => {
    if (isTransferring()) {
      const confirm = window.confirm(
        'File transfers are in progress. Are you sure you want to leave?'
      );
      if (!confirm) return;
    }
    stopStream();
    leaveSession();
    navigate('/');
  };

  const handleToggleVideo = () => {
    const enabled = toggleVideo();
    setVideoEnabled(enabled);
  };

  const handleToggleAudio = () => {
    const enabled = toggleAudio();
    setAudioEnabled(enabled);
  };

  // If not connected and we have a session ID, show join form
  if (!isConnected && !isConnecting && sessionId) {
    return (
      <div className="max-w-md mx-auto py-8">
        <div className="text-center mb-8">
          <h2 className="text-2xl font-bold mb-2">Join Session</h2>
          <p className="text-gray-400">You've been invited to join a VDO Samurai session.</p>
        </div>
        <JoinSession sessionId={sessionId} />
      </div>
    );
  }

  // Show loading while connecting
  if (isConnecting) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
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
    <div className="space-y-4">
      {/* Countdown overlay */}
      <CountdownOverlay countdown={countdown} />

      {/* On-air indicator */}
      <OnAirIndicator isRecording={isRecording} startTime={startTime} />

      {/* Transfer progress */}
      <TransferProgress />

      {/* Main video display */}
      <MainDisplay />

      {/* Participant tiles */}
      <TileGrid />

      {/* Controls */}
      <div
        className="flex items-center justify-center gap-2 sm:gap-3 py-4 px-2 flex-wrap"
        role="toolbar"
        aria-label="Session controls"
      >
        {/* Video toggle */}
        <button
          onClick={handleToggleVideo}
          className={`p-3 sm:p-4 rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[--color-dark] ${
            videoEnabled
              ? 'bg-gray-700 hover:bg-gray-600 text-white'
              : 'bg-red-500 hover:bg-red-600 text-white'
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
          className={`p-3 sm:p-4 rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[--color-dark] ${
            audioEnabled
              ? 'bg-gray-700 hover:bg-gray-600 text-white'
              : 'bg-red-500 hover:bg-red-600 text-white'
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

        {/* Leave button */}
        <button
          onClick={handleLeave}
          className="p-3 sm:p-4 rounded-full bg-red-500 hover:bg-red-600 text-white transition-colors focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[--color-dark]"
          aria-label="Leave session"
          title="Leave session"
        >
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
              d="M16 8l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2M5 3a2 2 0 00-2 2v1c0 8.284 6.716 15 15 15h1a2 2 0 002-2v-3.28a1 1 0 00-.684-.948l-4.493-1.498a1 1 0 00-1.21.502l-1.13 2.257a11.042 11.042 0 01-5.516-5.517l2.257-1.128a1 1 0 00.502-1.21L9.228 3.683A1 1 0 008.28 3H5z"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}
