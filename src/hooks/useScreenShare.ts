import { useState, useCallback, useEffect, useRef } from 'react';
import { useSessionStore } from '../store/sessionStore';
import { useRecordingStore } from '../store/recordingStore';
import { usePeerManager } from './usePeerManager';
import { ScreenRecorder } from '../utils/ScreenRecorder';
import { isElectron } from '../utils/platform';

export interface ScreenShareOptions {
  /** Called when screen share starts during an active recording */
  onScreenShareStartedDuringRecording?: (screenRecordingId: string) => void;
  /** Called when screen share ends during an active recording */
  onScreenShareEndedDuringRecording?: (screenRecordingId: string) => void;
}

export function useScreenShare(options: ScreenShareOptions = {}) {
  const { onScreenShareStartedDuringRecording, onScreenShareEndedDuringRecording } = options;
  const [isSharing, setIsSharing] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { setLocalScreenStream } = useSessionStore();
  const { isRecording, setScreenRecordingId, setLocalScreenBlob } = useRecordingStore();
  const streamRef = useRef<MediaStream | null>(null);
  const screenRecorderRef = useRef<ScreenRecorder | null>(null);
  // Store the active screen recording ID for callback when screen share ends
  const activeScreenRecordingIdRef = useRef<string | null>(null);

  // Get peer manager methods for stream management
  const { addLocalStream, removeLocalStream } = usePeerManager();

  // Lazy initialization of screen recorder
  const getScreenRecorder = useCallback(() => {
    if (!screenRecorderRef.current) {
      screenRecorderRef.current = new ScreenRecorder();
    }
    return screenRecorderRef.current;
  }, []);

  const startBrowserScreenShare = useCallback(async (): Promise<MediaStream> => {
    return navigator.mediaDevices.getDisplayMedia({
      video: {
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        frameRate: { ideal: 30 }
      },
      audio: true
    });
  }, []);

  const startElectronScreenShare = useCallback(async (sourceId: string): Promise<MediaStream> => {
    // In Electron, we use getUserMedia with Chromium-specific constraints
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: sourceId,
          minWidth: 1280,
          maxWidth: 1920,
          minHeight: 720,
          maxHeight: 1080,
          minFrameRate: 15,
          maxFrameRate: 30
        }
      } as MediaTrackConstraints
    });

    return stream;
  }, []);

  const startSharingWithSource = useCallback(
    async (sourceId?: string) => {
      try {
        setError(null);
        setShowPicker(false);

        let stream: MediaStream;
        if (isElectron()) {
          if (!sourceId) {
            throw new Error('Source ID required for Electron screen share');
          }
          stream = await startElectronScreenShare(sourceId);
        } else {
          stream = await startBrowserScreenShare();
        }

        streamRef.current = stream;
        setLocalScreenStream(stream);
        setIsSharing(true);

        // Add screen stream to peer manager (will only stream if we become active)
        addLocalStream(stream, { type: 'screen' });

        // If recording is active, start screen recording
        const screenRecorder = getScreenRecorder();
        if (isRecording && !screenRecorder.isRecording()) {
          try {
            const screenId = await screenRecorder.start(stream);
            setScreenRecordingId(screenId);
            activeScreenRecordingIdRef.current = screenId;

            // Broadcast screen clip start to peers
            onScreenShareStartedDuringRecording?.(screenId);

            console.log(
              '[useScreenShare] Started screen recording during active session:',
              screenId
            );
          } catch (err) {
            console.error('[useScreenShare] Failed to start screen recording:', err);
          }
        }

        // Handle stream end (user clicks "Stop sharing" in browser)
        const videoTrack = stream.getVideoTracks()[0];
        if (videoTrack) {
          videoTrack.addEventListener('ended', async () => {
            // If screen recording is active, stop it and save the blob
            const recorder = getScreenRecorder();
            if (recorder.isRecording()) {
              try {
                // Broadcast screen clip end to peers before stopping
                const screenId = activeScreenRecordingIdRef.current;
                if (screenId) {
                  onScreenShareEndedDuringRecording?.(screenId);
                  activeScreenRecordingIdRef.current = null;
                }

                const screenBlob = await recorder.stop();
                setLocalScreenBlob(screenBlob);
                console.log(
                  '[useScreenShare] Stopped screen recording on stream end, blob size:',
                  screenBlob.size
                );
              } catch (err) {
                console.error('[useScreenShare] Failed to stop screen recording:', err);
              }
            }

            if (streamRef.current) {
              removeLocalStream(streamRef.current, true);
            }
            setLocalScreenStream(null);
            setIsSharing(false);
            streamRef.current = null;
          });
        }

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
    [
      setLocalScreenStream,
      isRecording,
      setScreenRecordingId,
      setLocalScreenBlob,
      addLocalStream,
      removeLocalStream,
      getScreenRecorder,
      startBrowserScreenShare,
      startElectronScreenShare,
      onScreenShareStartedDuringRecording,
      onScreenShareEndedDuringRecording
    ]
  );

  const startSharing = useCallback(async () => {
    // In Electron, show the picker first
    if (isElectron()) {
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
    const screenRecorder = getScreenRecorder();
    if (screenRecorder.isRecording()) {
      try {
        // Broadcast screen clip end to peers before stopping
        const screenId = activeScreenRecordingIdRef.current;
        if (screenId) {
          onScreenShareEndedDuringRecording?.(screenId);
          activeScreenRecordingIdRef.current = null;
        }

        const screenBlob = await screenRecorder.stop();
        setLocalScreenBlob(screenBlob);
        console.log('[useScreenShare] Stopped screen recording, blob size:', screenBlob.size);
      } catch (err) {
        console.error('[useScreenShare] Failed to stop screen recording:', err);
      }
    }

    if (streamRef.current) {
      removeLocalStream(streamRef.current, true);
      // Stop all tracks
      streamRef.current.getTracks().forEach((track) => track.stop());
    }
    setLocalScreenStream(null);
    setIsSharing(false);
    streamRef.current = null;
  }, [
    setLocalScreenStream,
    setLocalScreenBlob,
    removeLocalStream,
    getScreenRecorder,
    onScreenShareEndedDuringRecording
  ]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
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
