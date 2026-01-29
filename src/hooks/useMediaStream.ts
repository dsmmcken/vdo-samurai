import { useState, useCallback } from 'react';
import { useSessionStore } from '../store/sessionStore';
import { MAIN_CONSTRAINTS, HIGH_QUALITY_CONSTRAINTS } from '../types';

export function useMediaStream() {
  const [isRequesting, setIsRequesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { localStream, localRecordingStream, setLocalStream, setLocalRecordingStream } = useSessionStore();

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
  }, [localStream, localRecordingStream, setLocalStream, setLocalRecordingStream]);

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
    toggleAudio
  };
}
