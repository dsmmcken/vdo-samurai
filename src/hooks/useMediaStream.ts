import { useState, useCallback } from 'react';
import { useSessionStore } from '../store/sessionStore';
import { MAIN_CONSTRAINTS } from '../types';

export function useMediaStream() {
  const [isRequesting, setIsRequesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { localStream, setLocalStream } = useSessionStore();

  const requestStream = useCallback(async () => {
    console.log('[useMediaStream] requestStream called, existing localStream:', !!localStream);
    if (localStream) return localStream;

    setIsRequesting(true);
    setError(null);

    try {
      console.log('[useMediaStream] Requesting getUserMedia with constraints:', MAIN_CONSTRAINTS);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: MAIN_CONSTRAINTS.video,
        audio: MAIN_CONSTRAINTS.audio
      });
      console.log('[useMediaStream] Got stream:', stream, 'video tracks:', stream.getVideoTracks());
      setLocalStream(stream);
      return stream;
    } catch (err) {
      console.error('[useMediaStream] getUserMedia error:', err);
      const message = err instanceof Error ? err.message : 'Failed to access camera/microphone';
      setError(message);
      throw err;
    } finally {
      setIsRequesting(false);
    }
  }, [localStream, setLocalStream]);

  const stopStream = useCallback(() => {
    if (localStream) {
      localStream.getTracks().forEach((track) => track.stop());
      setLocalStream(null);
    }
  }, [localStream, setLocalStream]);

  const toggleVideo = useCallback(() => {
    if (localStream) {
      const videoTrack = localStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        return videoTrack.enabled;
      }
    }
    return false;
  }, [localStream]);

  const toggleAudio = useCallback(() => {
    if (localStream) {
      const audioTrack = localStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        return audioTrack.enabled;
      }
    }
    return false;
  }, [localStream]);

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
