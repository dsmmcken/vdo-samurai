import { useState, useCallback, useRef, useEffect } from 'react';
import { useSessionStore } from '../store/sessionStore';
import { MAIN_CONSTRAINTS, HIGH_QUALITY_CONSTRAINTS } from '../types';

interface VideoToggleCallbacks {
  onBeforeVideoOff?: () => Promise<void>; // Stop current clip
  onAfterVideoOn?: () => Promise<void>; // Start new clip
  onRetryAttempt?: (attempt: number, error: Error) => void; // Called on retry during video ON
}

// Retry configuration for camera reacquisition
const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 2000, 4000]; // Exponential backoff

// Helper to determine if an error is retriable
function isRetriableError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  // NotAllowedError = permission denied, don't retry
  if (error.name === 'NotAllowedError') return false;
  // NotFoundError / NotReadableError = device issues, retry with backoff
  if (error.name === 'NotFoundError' || error.name === 'NotReadableError') return true;
  // Other errors (OverconstrainedError, etc.) may also be retriable
  return true;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function useMediaStream() {
  const [isRequesting, setIsRequesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { localStream, localRecordingStream, setLocalStream, setLocalRecordingStream } =
    useSessionStore();

  // Store the original device ID so we can re-request the same camera
  const cameraDeviceIdRef = useRef<string | null>(null);

  // Callback ref for video track 'ended' events (for recording integration)
  const onVideoTrackEndedRef = useRef<(() => Promise<void>) | null>(null);

  // Track cleanup handlers for 'ended' event listeners
  const trackEndedCleanupRef = useRef<(() => void) | null>(null);

  const requestStream = useCallback(async () => {
    console.log('[useMediaStream] requestStream called, existing localStream:', !!localStream);
    if (localStream) return localStream;

    setIsRequesting(true);
    setError(null);

    try {
      // First, get the high-quality recording stream to identify the camera device
      console.log(
        '[useMediaStream] Requesting HQ recording stream with constraints:',
        HIGH_QUALITY_CONSTRAINTS
      );
      const hqStream = await navigator.mediaDevices.getUserMedia({
        video: HIGH_QUALITY_CONSTRAINTS.video,
        audio: HIGH_QUALITY_CONSTRAINTS.audio
      });
      console.log(
        '[useMediaStream] Got HQ stream:',
        hqStream,
        'video tracks:',
        hqStream.getVideoTracks()
      );

      // Get the device ID from the HQ stream to ensure we use the same camera
      const videoTrack = hqStream.getVideoTracks()[0];
      const deviceId = videoTrack?.getSettings().deviceId;
      cameraDeviceIdRef.current = deviceId || null;

      // Create low-quality stream for streaming to peers, using same camera
      console.log('[useMediaStream] Requesting LQ streaming stream with device:', deviceId);
      const streamingConstraints = {
        video: {
          ...MAIN_CONSTRAINTS.video,
          deviceId: deviceId ? { exact: deviceId } : undefined
        },
        audio: false // We'll clone audio from HQ stream
      };

      const lqStream = await navigator.mediaDevices.getUserMedia(streamingConstraints);

      // Clone audio track from HQ stream to LQ stream
      const audioTrack = hqStream.getAudioTracks()[0];
      if (audioTrack) {
        lqStream.addTrack(audioTrack.clone());
      }

      console.log(
        '[useMediaStream] Got LQ stream:',
        lqStream,
        'video tracks:',
        lqStream.getVideoTracks()
      );

      setLocalRecordingStream(hqStream);
      setLocalStream(lqStream);

      // Set up 'ended' event listeners on video tracks for unexpected terminations
      const setupTrackEndedListeners = () => {
        const hqVideoTrack = hqStream.getVideoTracks()[0];

        const handleTrackEnded = async () => {
          console.log('[useMediaStream] Video track ended unexpectedly');
          if (onVideoTrackEndedRef.current) {
            try {
              await onVideoTrackEndedRef.current();
            } catch (err) {
              console.error('[useMediaStream] Error in onVideoTrackEnded callback:', err);
            }
          }
        };

        // Add listener to HQ track (only need one since HQ/LQ share the same physical device)
        hqVideoTrack?.addEventListener('ended', handleTrackEnded);

        // Store cleanup function
        trackEndedCleanupRef.current = () => {
          hqVideoTrack?.removeEventListener('ended', handleTrackEnded);
        };
      };

      setupTrackEndedListeners();

      return lqStream;
    } catch (err) {
      console.error('[useMediaStream] getUserMedia error:', err);
      const message = err instanceof Error ? err.message : 'Failed to access camera/microphone';
      setError(message);
      throw err;
    } finally {
      setIsRequesting(false);
    }
  }, [localStream, setLocalStream, setLocalRecordingStream]);

  const stopStream = useCallback(() => {
    // Clean up track ended listeners
    if (trackEndedCleanupRef.current) {
      trackEndedCleanupRef.current();
      trackEndedCleanupRef.current = null;
    }

    if (localStream) {
      localStream.getTracks().forEach((track) => track.stop());
      setLocalStream(null);
    }
    if (localRecordingStream) {
      localRecordingStream.getTracks().forEach((track) => track.stop());
      setLocalRecordingStream(null);
    }
    cameraDeviceIdRef.current = null;
  }, [localStream, localRecordingStream, setLocalStream, setLocalRecordingStream]);

  // Legacy toggle that just mutes (doesn't release camera)
  const toggleVideo = useCallback(() => {
    if (localStream) {
      const videoTrack = localStream.getVideoTracks()[0];
      if (videoTrack) {
        const newEnabled = !videoTrack.enabled;
        videoTrack.enabled = newEnabled;
        // Also toggle the recording stream video track to turn off camera light
        if (localRecordingStream) {
          const recordingVideoTrack = localRecordingStream.getVideoTracks()[0];
          if (recordingVideoTrack) {
            recordingVideoTrack.enabled = newEnabled;
          }
        }
        return newEnabled;
      }
    }
    return false;
  }, [localStream, localRecordingStream]);

  /**
   * Full video toggle that releases camera hardware when turning off.
   * This is used during recording to create discrete clips.
   *
   * @param callbacks - Optional callbacks for clip management
   * @returns Whether video is now enabled
   */
  const toggleVideoFull = useCallback(
    async (callbacks?: VideoToggleCallbacks): Promise<boolean> => {
      const wasEnabled = localStream?.getVideoTracks()[0]?.readyState === 'live';

      if (wasEnabled) {
        // Video ON → OFF: Release camera
        console.log('[useMediaStream] toggleVideoFull: releasing camera');

        // Clean up existing track ended listeners before stopping tracks
        if (trackEndedCleanupRef.current) {
          trackEndedCleanupRef.current();
          trackEndedCleanupRef.current = null;
        }

        // Call callback before stopping tracks
        await callbacks?.onBeforeVideoOff?.();

        // Stop video tracks on both streams (releases camera hardware)
        localStream?.getVideoTracks().forEach((t) => {
          console.log('[useMediaStream] Stopping LQ video track:', t.id);
          t.stop();
        });
        localRecordingStream?.getVideoTracks().forEach((t) => {
          console.log('[useMediaStream] Stopping HQ video track:', t.id);
          t.stop();
        });

        return false;
      } else {
        // Video OFF → ON: Reacquire camera with retry logic
        console.log('[useMediaStream] toggleVideoFull: reacquiring camera');

        let lastError: unknown = null;

        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
          try {
            if (attempt > 0) {
              console.log(`[useMediaStream] Retry attempt ${attempt}/${MAX_RETRIES}`);
              callbacks?.onRetryAttempt?.(attempt, lastError as Error);
              await sleep(RETRY_DELAYS[attempt - 1]);
            }

            // Request new video tracks using the same device ID if available
            const constraints = {
              video: cameraDeviceIdRef.current
                ? {
                    ...HIGH_QUALITY_CONSTRAINTS.video,
                    deviceId: { exact: cameraDeviceIdRef.current }
                  }
                : HIGH_QUALITY_CONSTRAINTS.video,
              audio: false // Keep existing audio tracks
            };

            const newHqStream = await navigator.mediaDevices.getUserMedia(constraints);
            const newHqVideoTrack = newHqStream.getVideoTracks()[0];

            // Add the new video track to the recording stream
            if (localRecordingStream && newHqVideoTrack) {
              // Remove any existing (stopped) video tracks
              localRecordingStream.getVideoTracks().forEach((t) => {
                localRecordingStream.removeTrack(t);
              });
              localRecordingStream.addTrack(newHqVideoTrack);
            }

            // Create LQ video track for streaming
            const lqConstraints = {
              video: cameraDeviceIdRef.current
                ? { ...MAIN_CONSTRAINTS.video, deviceId: { exact: cameraDeviceIdRef.current } }
                : MAIN_CONSTRAINTS.video,
              audio: false
            };

            const newLqStream = await navigator.mediaDevices.getUserMedia(lqConstraints);
            const newLqVideoTrack = newLqStream.getVideoTracks()[0];

            // Add to local stream
            if (localStream && newLqVideoTrack) {
              localStream.getVideoTracks().forEach((t) => {
                localStream.removeTrack(t);
              });
              localStream.addTrack(newLqVideoTrack);
            }

            // Set up 'ended' event listener on the new HQ video track
            if (newHqVideoTrack) {
              const handleTrackEnded = async () => {
                console.log('[useMediaStream] Video track ended unexpectedly (reacquired track)');
                if (onVideoTrackEndedRef.current) {
                  try {
                    await onVideoTrackEndedRef.current();
                  } catch (err) {
                    console.error('[useMediaStream] Error in onVideoTrackEnded callback:', err);
                  }
                }
              };

              newHqVideoTrack.addEventListener('ended', handleTrackEnded);
              trackEndedCleanupRef.current = () => {
                newHqVideoTrack.removeEventListener('ended', handleTrackEnded);
              };
            }

            // Call callback after acquiring new tracks
            await callbacks?.onAfterVideoOn?.();

            return true;
          } catch (err) {
            console.error(
              `[useMediaStream] Failed to reacquire camera (attempt ${attempt + 1}):`,
              err
            );
            lastError = err;

            // Don't retry if it's a non-retriable error
            if (!isRetriableError(err)) {
              console.log('[useMediaStream] Error is not retriable, giving up');
              break;
            }

            // Don't retry if we've exhausted retries
            if (attempt >= MAX_RETRIES) {
              console.log('[useMediaStream] Max retries reached, giving up');
              break;
            }
          }
        }

        return false;
      }
    },
    [localStream, localRecordingStream]
  );

  /**
   * Get an audio-only stream from the current recording stream.
   * Used for recording audio when video is toggled off.
   */
  const getAudioOnlyStream = useCallback((): MediaStream | null => {
    if (!localRecordingStream) return null;

    const audioTracks = localRecordingStream.getAudioTracks();
    if (audioTracks.length === 0) return null;

    // Create new stream with only audio (clone tracks to avoid affecting original)
    const audioStream = new MediaStream();
    audioTracks.forEach((track) => {
      audioStream.addTrack(track.clone());
    });

    return audioStream;
  }, [localRecordingStream]);

  /**
   * Check if video is currently enabled (track exists and is live)
   */
  const isVideoEnabled = useCallback((): boolean => {
    const videoTrack = localStream?.getVideoTracks()[0];
    return videoTrack?.readyState === 'live' && videoTrack?.enabled;
  }, [localStream]);

  /**
   * Check if audio is currently enabled
   */
  const isAudioEnabled = useCallback((): boolean => {
    const audioTrack = localStream?.getAudioTracks()[0];
    return audioTrack?.enabled ?? false;
  }, [localStream]);

  const toggleAudio = useCallback(() => {
    if (localStream) {
      const audioTrack = localStream.getAudioTracks()[0];
      if (audioTrack) {
        const newEnabled = !audioTrack.enabled;
        audioTrack.enabled = newEnabled;
        // Also toggle the recording stream audio track
        if (localRecordingStream) {
          const recordingAudioTrack = localRecordingStream.getAudioTracks()[0];
          if (recordingAudioTrack) {
            recordingAudioTrack.enabled = newEnabled;
          }
        }
        return newEnabled;
      }
    }
    return false;
  }, [localStream, localRecordingStream]);

  /**
   * Set a callback to be invoked when the video track ends unexpectedly.
   * Used by useRecording to handle clip transitions when camera is disconnected.
   */
  const setOnVideoTrackEnded = useCallback((callback: (() => Promise<void>) | null) => {
    onVideoTrackEndedRef.current = callback;
  }, []);

  // Clean up listeners on unmount
  useEffect(() => {
    return () => {
      if (trackEndedCleanupRef.current) {
        trackEndedCleanupRef.current();
        trackEndedCleanupRef.current = null;
      }
    };
  }, []);

  // Note: We don't stop tracks on unmount because the stream is stored in
  // global Zustand state and may be used by other components. Tracks are
  // stopped explicitly via stopStream() when leaving the session.

  return {
    stream: localStream,
    isRequesting,
    error,
    requestStream,
    stopStream,
    toggleVideo,
    toggleVideoFull,
    toggleAudio,
    getAudioOnlyStream,
    isVideoEnabled,
    isAudioEnabled,
    setOnVideoTrackEnded
  };
}
