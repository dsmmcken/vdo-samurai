import { useState, useCallback, useEffect, useRef } from 'react';
import { useSessionStore } from '../store/sessionStore';
import { useRecordingStore } from '../store/recordingStore';
import { screenCaptureService } from '../services/media/ScreenCaptureService';
import { peerManager } from '../services/p2p';
import { screenRecorder } from '../services/recording';

export function useScreenShare() {
  const [isSharing, setIsSharing] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { setLocalScreenStream, setActiveScreenSharePeerId } = useSessionStore();
  const { isRecording, setScreenRecordingId, setLocalScreenBlob } = useRecordingStore();
  const streamRef = useRef<MediaStream | null>(null);

  const startSharingWithSource = useCallback(
    async (sourceId?: string) => {
      try {
        setError(null);
        setShowPicker(false);
        const stream = await screenCaptureService.startScreenShare(sourceId);
        streamRef.current = stream;
        setLocalScreenStream(stream);
        setIsSharing(true);

        // Add screen stream to peer manager (will only stream if we become active)
        peerManager.addLocalStream(stream, { type: 'screen' });

        // If recording is active, start screen recording
        if (isRecording && !screenRecorder.isRecording()) {
          try {
            const screenId = await screenRecorder.start(stream);
            setScreenRecordingId(screenId);
            console.log('[useScreenShare] Started screen recording during active session:', screenId);
          } catch (err) {
            console.error('[useScreenShare] Failed to start screen recording:', err);
          }
        }

        // Handle stream end (user clicks "Stop sharing" in browser)
        screenCaptureService.onEnd(async () => {
          // If screen recording is active, stop it and save the blob
          if (screenRecorder.isRecording()) {
            try {
              const screenBlob = await screenRecorder.stop();
              setLocalScreenBlob(screenBlob);
              console.log('[useScreenShare] Stopped screen recording on stream end, blob size:', screenBlob.size);
            } catch (err) {
              console.error('[useScreenShare] Failed to stop screen recording:', err);
            }
          }

          if (streamRef.current) {
            peerManager.removeLocalStream(streamRef.current, true);
          }
          setLocalScreenStream(null);
          setIsSharing(false);
          streamRef.current = null;
        });

        return stream;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to share screen';
        // User cancelled is not an error
        if (err instanceof Error && err.name === 'NotAllowedError') {
          setError(null);
        } else {
          setError(message);
        }
        throw err;
      }
    },
    [setLocalScreenStream, isRecording, setScreenRecordingId, setLocalScreenBlob]
  );

  const startSharing = useCallback(async () => {
    // In Electron, show the picker first
    if (screenCaptureService.needsSourcePicker()) {
      setShowPicker(true);
      return undefined;
    }
    // In browser, start directly
    return startSharingWithSource();
  }, [startSharingWithSource]);

  const cancelPicker = useCallback(() => {
    setShowPicker(false);
  }, []);

  const stopSharing = useCallback(async () => {
    // If screen recording is active, stop it and save the blob
    if (screenRecorder.isRecording()) {
      try {
        const screenBlob = await screenRecorder.stop();
        setLocalScreenBlob(screenBlob);
        console.log('[useScreenShare] Stopped screen recording, blob size:', screenBlob.size);
      } catch (err) {
        console.error('[useScreenShare] Failed to stop screen recording:', err);
      }
    }

    if (streamRef.current) {
      peerManager.removeLocalStream(streamRef.current, true);
    }
    screenCaptureService.stopScreenShare();
    setLocalScreenStream(null);
    setIsSharing(false);
    streamRef.current = null;
  }, [setLocalScreenStream, setLocalScreenBlob]);

  // Subscribe to active screen share changes
  useEffect(() => {
    peerManager.setOnActiveScreenShareChange((peerId) => {
      setActiveScreenSharePeerId(peerId);
    });

    return () => {
      peerManager.setOnActiveScreenShareChange(() => {});
    };
  }, [setActiveScreenSharePeerId]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        screenCaptureService.stopScreenShare();
      }
    };
  }, []);

  return {
    isSharing,
    showPicker,
    startSharing,
    startSharingWithSource,
    stopSharing,
    cancelPicker,
    error
  };
}
