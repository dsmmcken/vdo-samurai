import { useCallback, useEffect, useRef } from 'react';
import { type Room } from 'trystero/torrent';
import { useRecordingStore } from '../store/recordingStore';
import { useSessionStore } from '../store/sessionStore';
import { localRecorder, screenRecorder, recordingCoordinator } from '../services/recording';

export function useRecording(room?: Room) {
  const { localRecordingStream, localScreenStream, isHost } = useSessionStore();
  const {
    isRecording,
    countdown,
    startTime,
    setIsRecording,
    setCountdown,
    setStartTime,
    setEndTime,
    setRecordingId,
    setScreenRecordingId,
    setLocalBlob,
    setLocalScreenBlob,
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

        // Start camera recording using high-quality stream
        if (localRecordingStream) {
          try {
            const id = await localRecorder.start(localRecordingStream);
            setRecordingId(id);
            setIsRecording(true);
            setStartTime(Date.now());
          } catch (err) {
            console.error('Failed to start camera recording:', err);
          }
        }

        // Start screen recording if screen share is active
        if (localScreenStream) {
          try {
            const screenId = await screenRecorder.start(localScreenStream);
            setScreenRecordingId(screenId);
            console.log('[useRecording] Started screen recording:', screenId);
          } catch (err) {
            console.error('Failed to start screen recording:', err);
          }
        }
      });

      recordingCoordinator.onStop(async () => {
        setEndTime(Date.now());

        // Stop camera recording
        if (localRecorder.isRecording()) {
          try {
            const blob = await localRecorder.stop();
            setLocalBlob(blob);
          } catch (err) {
            console.error('Failed to stop camera recording:', err);
          }
        }

        // Stop screen recording
        if (screenRecorder.isRecording()) {
          try {
            const screenBlob = await screenRecorder.stop();
            setLocalScreenBlob(screenBlob);
            console.log('[useRecording] Stopped screen recording, blob size:', screenBlob.size);
          } catch (err) {
            console.error('Failed to stop screen recording:', err);
          }
        }

        setIsRecording(false);
      });
    }

    return () => {
      if (initializedRef.current) {
        recordingCoordinator.clear();
        localRecorder.cleanup();
        screenRecorder.cleanup();
        initializedRef.current = false;
      }
    };
  }, [
    room,
    localRecordingStream,
    localScreenStream,
    setCountdown,
    setIsRecording,
    setStartTime,
    setEndTime,
    setRecordingId,
    setScreenRecordingId,
    setLocalBlob,
    setLocalScreenBlob
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
    screenRecorder.cleanup();
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
