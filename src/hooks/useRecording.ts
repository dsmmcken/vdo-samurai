import { useCallback, useEffect, useRef } from 'react';
import { type Room } from 'trystero/torrent';
import { useRecordingStore } from '../store/recordingStore';
import { useSessionStore } from '../store/sessionStore';
import { localRecorder, recordingCoordinator } from '../services/recording';

export function useRecording(room?: Room) {
  const { localStream, isHost } = useSessionStore();
  const {
    isRecording,
    countdown,
    startTime,
    setIsRecording,
    setCountdown,
    setStartTime,
    setEndTime,
    setRecordingId,
    setLocalBlob,
    reset
  } = useRecordingStore();

  const initializedRef = useRef(false);

  useEffect(() => {
    if (room && !initializedRef.current) {
      initializedRef.current = true;
      recordingCoordinator.initialize(room);

      recordingCoordinator.onCountdown((count) => {
        setCountdown(count);
      });

      recordingCoordinator.onStart(async () => {
        setCountdown(null);

        if (localStream) {
          try {
            const id = await localRecorder.start(localStream);
            setRecordingId(id);
            setIsRecording(true);
            setStartTime(Date.now());
          } catch (err) {
            console.error('Failed to start recording:', err);
          }
        }
      });

      recordingCoordinator.onStop(async () => {
        setEndTime(Date.now());
        if (localRecorder.isRecording()) {
          try {
            const blob = await localRecorder.stop();
            setLocalBlob(blob);
          } catch (err) {
            console.error('Failed to stop recording:', err);
          }
        }
        setIsRecording(false);
      });
    }

    return () => {
      if (initializedRef.current) {
        recordingCoordinator.clear();
        localRecorder.cleanup();
        initializedRef.current = false;
      }
    };
  }, [
    room,
    localStream,
    setCountdown,
    setIsRecording,
    setStartTime,
    setEndTime,
    setRecordingId,
    setLocalBlob
  ]);

  const startRecording = useCallback(async () => {
    if (!isHost) return;

    await recordingCoordinator.triggerCountdown();
    recordingCoordinator.triggerStart();
  }, [isHost]);

  const stopRecording = useCallback(() => {
    if (!isHost) return;

    recordingCoordinator.triggerStop();
  }, [isHost]);

  const resetRecording = useCallback(() => {
    localRecorder.cleanup();
    reset();
  }, [reset]);

  return {
    isRecording,
    countdown,
    startTime,
    startRecording,
    stopRecording,
    resetRecording,
    isHost
  };
}
