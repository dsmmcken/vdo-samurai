import { useCallback, useEffect, useRef } from 'react';
import { useRecordingStore } from '../store/recordingStore';
import { useSessionStore } from '../store/sessionStore';
import { useTrystero } from '../contexts/TrysteroContext';
import { LocalRecorder } from '../utils/LocalRecorder';
import { ScreenRecorder } from '../utils/ScreenRecorder';

interface RecordingMessage {
  type: 'countdown' | 'start' | 'stop';
  timestamp: number;
  countdown?: number;
}

export function useRecording() {
  const { room } = useTrystero();
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

  // Recorder instances via useRef
  const cameraRecorderRef = useRef<LocalRecorder | null>(null);
  const screenRecorderRef = useRef<ScreenRecorder | null>(null);

  // Recording coordinator state
  const sendRecordingMessageRef = useRef<((data: RecordingMessage) => void) | null>(null);

  // Lazy initialization of recorders
  const getCameraRecorder = useCallback(() => {
    if (!cameraRecorderRef.current) {
      cameraRecorderRef.current = new LocalRecorder();
    }
    return cameraRecorderRef.current;
  }, []);

  const getScreenRecorder = useCallback(() => {
    if (!screenRecorderRef.current) {
      screenRecorderRef.current = new ScreenRecorder();
    }
    return screenRecorderRef.current;
  }, []);

  useEffect(() => {
    if (room && !initializedRef.current) {
      initializedRef.current = true;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const [sendRecording, onRecording] = room.makeAction<any>('recording');
      sendRecordingMessageRef.current = sendRecording;

      onRecording((data: unknown) => {
        if (typeof data !== 'object' || data === null) return;

        const message = data as RecordingMessage;

        switch (message.type) {
          case 'countdown':
            if (typeof message.countdown === 'number') {
              setCountdown(message.countdown);
            }
            break;
          case 'start':
            handleStartRecording();
            break;
          case 'stop':
            handleStopRecording();
            break;
        }
      });
    }

    return () => {
      if (initializedRef.current) {
        sendRecordingMessageRef.current = null;
        cameraRecorderRef.current?.cleanup();
        screenRecorderRef.current?.cleanup();
        initializedRef.current = false;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room]);

  const handleStartRecording = useCallback(async () => {
    setCountdown(null);
    const cameraRecorder = getCameraRecorder();
    const screenRecorder = getScreenRecorder();

    // Start camera recording using high-quality stream
    if (localRecordingStream) {
      try {
        const id = await cameraRecorder.start(localRecordingStream);
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
  }, [
    localRecordingStream,
    localScreenStream,
    getCameraRecorder,
    getScreenRecorder,
    setCountdown,
    setIsRecording,
    setStartTime,
    setRecordingId,
    setScreenRecordingId
  ]);

  const handleStopRecording = useCallback(async () => {
    setEndTime(Date.now());
    const cameraRecorder = getCameraRecorder();
    const screenRecorder = getScreenRecorder();

    // Stop camera recording
    if (cameraRecorder.isRecording()) {
      try {
        const blob = await cameraRecorder.stop();
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
  }, [getCameraRecorder, getScreenRecorder, setEndTime, setLocalBlob, setLocalScreenBlob, setIsRecording]);

  const startRecording = useCallback(async () => {
    if (!isHost) return;

    // Trigger countdown sequence
    for (let i = 3; i >= 1; i--) {
      const message: RecordingMessage = { type: 'countdown', countdown: i, timestamp: Date.now() };
      sendRecordingMessageRef.current?.(message);
      setCountdown(i);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    // Trigger start
    const startMessage: RecordingMessage = { type: 'start', timestamp: Date.now() };
    sendRecordingMessageRef.current?.(startMessage);
    handleStartRecording();
  }, [isHost, setCountdown, handleStartRecording]);

  const stopRecording = useCallback(() => {
    if (!isHost) return;

    const stopMessage: RecordingMessage = { type: 'stop', timestamp: Date.now() };
    sendRecordingMessageRef.current?.(stopMessage);
    handleStopRecording();
  }, [isHost, handleStopRecording]);

  const resetRecording = useCallback(() => {
    cameraRecorderRef.current?.cleanup();
    screenRecorderRef.current?.cleanup();
    reset();
  }, [reset]);

  // Expose screen recorder for useScreenShare
  const getScreenRecorderInstance = useCallback(() => getScreenRecorder(), [getScreenRecorder]);

  return {
    isRecording,
    countdown,
    startTime,
    startRecording,
    stopRecording,
    resetRecording,
    isHost,
    getScreenRecorderInstance
  };
}
