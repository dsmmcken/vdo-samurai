import { useState, useCallback, useRef } from 'react';
import { useSessionStore } from '../store/sessionStore';
import { MAIN_CONSTRAINTS, HIGH_QUALITY_CONSTRAINTS } from '../types';

interface VideoToggleCallbacks {
  onBeforeVideoOff?: () => Promise<void>;  // Stop current clip
  onAfterVideoOn?: () => Promise<void>;    // Start new clip
}

export function useMediaStream() {
  const [isRequesting, setIsRequesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { localStream, localRecordingStream, setLocalStream, setLocalRecordingStream } = useSessionStore();

  // Store the original device ID so we can re-request the same camera
  const cameraDeviceIdRef = useRef<string | null>(null);

  const requestStream = useCallback(async () => {
    console.log('[useMediaStream] requestStream called, existing localStream:', !!localStream);
    if (localStream) return localStream;

    setIsRequesting(true);
    setError(null);

    try {
      // First, get the high-quality recording stream to identify the camera device
      console.log('[useMediaStream] Requesting HQ recording stream with constraints:', HIGH_QUALITY_CONSTRAINTS);
      const hqStream = await navigator.mediaDevices.getUserMedia({
        video: HIGH_QUALITY_CONSTRAINTS.video,
        audio: HIGH_QUALITY_CONSTRAINTS.audio
      });
      console.log('[useMediaStream] Got HQ stream:', hqStream, 'video tracks:', hqStream.getVideoTracks());

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

      console.log('[useMediaStream] Got LQ stream:', lqStream, 'video tracks:', lqStream.getVideoTracks());

      setLocalRecordingStream(hqStream);
      setLocalStream(lqStream);
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
  const toggleVideoFull = useCallback(async (
    callbacks?: VideoToggleCallbacks
  ): Promise<boolean> => {
    const wasEnabled = localStream?.getVideoTracks()[0]?.readyState === 'live';

    if (wasEnabled) {
      // Video ON → OFF: Release camera
      console.log('[useMediaStream] toggleVideoFull: releasing camera');

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
      // Video OFF → ON: Reacquire camera
      console.log('[useMediaStream] toggleVideoFull: reacquiring camera');

      try {
        // Request new video tracks using the same device ID if available
        const constraints = {
          video: cameraDeviceIdRef.current
            ? { ...HIGH_QUALITY_CONSTRAINTS.video, deviceId: { exact: cameraDeviceIdRef.current } }
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

        // Call callback after acquiring new tracks
        await callbacks?.onAfterVideoOn?.();

        return true;
      } catch (err) {
        console.error('[useMediaStream] Failed to reacquire camera:', err);
        return false;
      }
    }
  }, [localStream, localRecordingStream]);

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
    isAudioEnabled
  };
}
