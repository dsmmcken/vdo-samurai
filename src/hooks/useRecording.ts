import { useCallback, useEffect, useRef } from 'react';
import { selfId } from 'trystero/nostr';
import { useRecordingStore } from '../store/recordingStore';
import { useSessionStore } from '../store/sessionStore';
import { useTrystero } from '../contexts/TrysteroContext';
import { ClipRecorder } from '../utils/ClipRecorder';
import { ScreenRecorder } from '../utils/ScreenRecorder';
import { useClockSync } from './useClockSync';
import type { PeerClipMessage } from '../types/messages';

interface RecordingMessage {
  type: 'pre-sync' | 'countdown' | 'start' | 'stop';
  timestamp: number;
  countdown?: number;
  globalClockStart?: number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function useRecording() {
  const { room } = useTrystero();
  const { localRecordingStream, localScreenStream, isHost } = useSessionStore();
  const {
    isRecording,
    countdown,
    startTime,
    globalClockStart,
    clockOffset,
    localClips,
    setIsRecording,
    setCountdown,
    setStartTime,
    setEndTime,
    setRecordingId,
    setScreenRecordingId,
    setLocalBlob,
    setLocalScreenBlob,
    setGlobalClockStart,
    setGlobalClockEnd,
    startClip,
    stopClip,
    finalizeClip,
    addPeerClip,
    updatePeerClip,
    clearClips,
    reset
  } = useRecordingStore();

  const { syncWithHost } = useClockSync();

  const initializedRef = useRef(false);
  const clipRecorderRef = useRef<ClipRecorder | null>(null);
  const screenRecorderRef = useRef<ScreenRecorder | null>(null);
  const sendRecordingMessageRef = useRef<((data: RecordingMessage) => void) | null>(null);
  const sendPeerClipMessageRef = useRef<((data: PeerClipMessage) => void) | null>(null);
  const activeAudioClipIdRef = useRef<string | null>(null);
  // Refs to avoid stale closures in P2P message handlers
  const handleStartRecordingRef = useRef<((hostGlobalClockStart: number) => void) | null>(null);
  const handleStopRecordingRef = useRef<(() => void) | null>(null);

  // Lazy initialization of recorders
  const getClipRecorder = useCallback(() => {
    if (!clipRecorderRef.current) {
      clipRecorderRef.current = new ClipRecorder();
    }
    return clipRecorderRef.current;
  }, []);

  const getScreenRecorder = useCallback(() => {
    if (!screenRecorderRef.current) {
      screenRecorderRef.current = new ScreenRecorder();
    }
    return screenRecorderRef.current;
  }, []);

  // Initialize P2P message handlers
  useEffect(() => {
    if (room && !initializedRef.current) {
      initializedRef.current = true;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const [sendRecording, onRecording] = room.makeAction<any>('recording');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const [sendPeerClip, onPeerClip] = room.makeAction<any>('peer-clip');

      sendRecordingMessageRef.current = sendRecording;
      sendPeerClipMessageRef.current = sendPeerClip;

      onRecording(async (data: unknown) => {
        if (typeof data !== 'object' || data === null) return;

        const message = data as RecordingMessage;

        switch (message.type) {
          case 'pre-sync':
            // Fresh clock sync before recording (runs during countdown)
            console.log('[useRecording] Pre-sync requested, performing clock sync...');
            await syncWithHost();
            break;
          case 'countdown':
            if (typeof message.countdown === 'number') {
              setCountdown(message.countdown);
            }
            break;
          case 'start':
            if (message.globalClockStart) {
              // Use ref to get the latest handler (avoids stale closure)
              handleStartRecordingRef.current?.(message.globalClockStart);
            }
            break;
          case 'stop':
            // Use ref to get the latest handler (avoids stale closure)
            handleStopRecordingRef.current?.();
            break;
        }
      });

      // Handle peer clip messages
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      onPeerClip((data: unknown, _peerId: string) => {
        if (typeof data !== 'object' || data === null) return;
        const clipMsg = data as PeerClipMessage;

        if (clipMsg.action === 'started') {
          addPeerClip({
            id: clipMsg.clipId,
            recordingId: clipMsg.clipId,
            peerId: clipMsg.peerId,
            sourceType: clipMsg.sourceType,
            globalStartTime: clipMsg.globalStartTime,
            globalEndTime: null,
            status: 'recording'
          });
        } else if (clipMsg.action === 'stopped') {
          updatePeerClip(clipMsg.clipId, {
            globalEndTime: clipMsg.globalEndTime,
            status: 'stopped'
          });
        }
      });
    }

    return () => {
      if (initializedRef.current) {
        sendRecordingMessageRef.current = null;
        sendPeerClipMessageRef.current = null;
        clipRecorderRef.current?.cleanup();
        screenRecorderRef.current?.cleanup();
        initializedRef.current = false;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room]);

  /**
   * Broadcast clip info to peers
   */
  const broadcastClipInfo = useCallback(
    (
      clipId: string,
      sourceType: 'camera' | 'screen' | 'audio-only',
      globalStartTime: number,
      globalEndTime: number | null,
      action: 'started' | 'stopped'
    ) => {
      const msg: PeerClipMessage = {
        type: 'peer-clip',
        clipId,
        peerId: selfId,
        sourceType,
        globalStartTime,
        globalEndTime,
        action
      };
      sendPeerClipMessageRef.current?.(msg);
    },
    []
  );

  /**
   * Handle start recording (called when receiving start message)
   */
  const handleStartRecording = useCallback(
    async (hostGlobalClockStart: number) => {
      setCountdown(null);
      setGlobalClockStart(hostGlobalClockStart);
      setStartTime(Date.now());

      const clipRecorder = getClipRecorder();

      // Set clock reference for the recorder
      clipRecorder.setClockReference(hostGlobalClockStart, clockOffset);

      // Start camera recording using high-quality stream
      if (localRecordingStream) {
        try {
          const { clipId, globalStartTime } =
            await clipRecorder.startVideoClip(localRecordingStream);

          // Register clip in store
          startClip({
            recordingId: clipId,
            peerId: selfId,
            sourceType: 'camera',
            globalStartTime,
            globalEndTime: null,
            status: 'recording'
          });

          // Broadcast to peers
          broadcastClipInfo(clipId, 'camera', globalStartTime, null, 'started');

          setRecordingId(clipId);
          setIsRecording(true);
          console.log('[useRecording] Started video clip:', clipId);
        } catch (err) {
          console.error('[useRecording] Failed to start camera recording:', err);
        }
      }

      // Start screen recording if screen share is active
      if (localScreenStream) {
        const screenRecorder = getScreenRecorder();
        try {
          const screenId = await screenRecorder.start(localScreenStream);
          setScreenRecordingId(screenId);
          console.log('[useRecording] Started screen recording:', screenId);
        } catch (err) {
          console.error('[useRecording] Failed to start screen recording:', err);
        }
      }
    },
    [
      clockOffset,
      localRecordingStream,
      localScreenStream,
      getClipRecorder,
      getScreenRecorder,
      setCountdown,
      setGlobalClockStart,
      setStartTime,
      setIsRecording,
      setRecordingId,
      setScreenRecordingId,
      startClip,
      broadcastClipInfo
    ]
  );

  /**
   * Handle stop recording (called when receiving stop message)
   */
  const handleStopRecording = useCallback(async () => {
    const clipRecorder = getClipRecorder();
    const screenRecorder = getScreenRecorder();

    setEndTime(Date.now());
    setGlobalClockEnd(clipRecorder.getGlobalTime());

    // Stop all active clips
    const stoppedClips = await clipRecorder.stopAllClips();

    // Get fresh localClips from store to avoid stale closure
    const currentLocalClips = useRecordingStore.getState().localClips;

    // Process stopped clips
    for (const { clipId, globalEndTime, blob } of stoppedClips) {
      // Find clip by recordingId, not id (clipId is the recorder's ID, stored as recordingId)
      const clip = currentLocalClips.find((c) => c.recordingId === clipId);

      // Use the store's clip ID for updates, or fall back to recorder's clipId
      const storeClipId = clip?.id || clipId;
      stopClip(storeClipId, globalEndTime);
      finalizeClip(storeClipId, blob);

      // Broadcast to peers
      broadcastClipInfo(
        clipId,
        clip?.sourceType || 'camera',
        clip?.globalStartTime || 0,
        globalEndTime,
        'stopped'
      );

      // Set legacy localBlob for backwards compatibility (use first camera clip)
      if (clip?.sourceType === 'camera') {
        setLocalBlob(blob);
      }
    }

    // Stop any audio-only clip
    if (activeAudioClipIdRef.current) {
      activeAudioClipIdRef.current = null;
    }

    // Stop screen recording
    if (screenRecorder.isRecording()) {
      try {
        const screenBlob = await screenRecorder.stop();
        setLocalScreenBlob(screenBlob);
        console.log('[useRecording] Stopped screen recording, blob size:', screenBlob.size);
      } catch (err) {
        console.error('[useRecording] Failed to stop screen recording:', err);
      }
    }

    setIsRecording(false);
  }, [
    getClipRecorder,
    getScreenRecorder,
    setEndTime,
    setGlobalClockEnd,
    setLocalBlob,
    setLocalScreenBlob,
    setIsRecording,
    stopClip,
    finalizeClip,
    broadcastClipInfo
  ]);

  // Keep refs up to date to avoid stale closures in P2P message handlers
  // This is necessary because onRecording callback is set up once and captures
  // the handlers at that moment. Using refs allows us to always call the latest version.
  useEffect(() => {
    handleStartRecordingRef.current = handleStartRecording;
  }, [handleStartRecording]);

  useEffect(() => {
    handleStopRecordingRef.current = handleStopRecording;
  }, [handleStopRecording]);

  /**
   * Start recording (host only)
   * Initiates countdown and synchronizes all peers
   */
  const startRecording = useCallback(async () => {
    if (!isHost) return;

    // 1. Broadcast pre-sync request (peers will sync during countdown)
    sendRecordingMessageRef.current?.({ type: 'pre-sync', timestamp: Date.now() });

    // 2. Start fresh sync for ourselves
    const syncPromise = syncWithHost();

    // 3. Countdown 3-2-1
    for (let i = 3; i >= 1; i--) {
      const message: RecordingMessage = { type: 'countdown', countdown: i, timestamp: Date.now() };
      sendRecordingMessageRef.current?.(message);
      setCountdown(i);
      await sleep(1000);
    }

    // 4. Wait for sync to complete
    await syncPromise;

    // 5. Broadcast start with globalClockStart
    const globalClockStart = Date.now();
    const startMessage: RecordingMessage = {
      type: 'start',
      timestamp: Date.now(),
      globalClockStart
    };
    sendRecordingMessageRef.current?.(startMessage);
    handleStartRecording(globalClockStart);
  }, [isHost, setCountdown, syncWithHost, handleStartRecording]);

  /**
   * Stop recording (host only)
   */
  const stopRecording = useCallback(() => {
    if (!isHost) return;

    const stopMessage: RecordingMessage = { type: 'stop', timestamp: Date.now() };
    sendRecordingMessageRef.current?.(stopMessage);
    handleStopRecording();
  }, [isHost, handleStopRecording]);

  /**
   * Called when video is toggled ON during recording.
   * Stops any active audio-only clip and starts a new video clip.
   */
  const onVideoEnabled = useCallback(async () => {
    if (!isRecording || !localRecordingStream) return;

    const clipRecorder = getClipRecorder();

    // Stop any active audio-only clip
    const audioClipId = clipRecorder.getActiveAudioClipId();
    if (audioClipId) {
      try {
        const { globalEndTime, blob } = await clipRecorder.stopClip(audioClipId);
        // Find by recordingId (audioClipId is the recorder's ID)
        const clip = localClips.find((c) => c.recordingId === audioClipId);
        const storeClipId = clip?.id || audioClipId;

        stopClip(storeClipId, globalEndTime);
        finalizeClip(storeClipId, blob);
        broadcastClipInfo(
          audioClipId,
          'audio-only',
          clip?.globalStartTime || 0,
          globalEndTime,
          'stopped'
        );

        activeAudioClipIdRef.current = null;
        console.log('[useRecording] Stopped audio-only clip:', audioClipId);
      } catch (err) {
        console.error('[useRecording] Failed to stop audio clip:', err);
      }
    }

    // Start new video+audio clip
    try {
      const { clipId, globalStartTime } = await clipRecorder.startVideoClip(localRecordingStream);

      startClip({
        recordingId: clipId,
        peerId: selfId,
        sourceType: 'camera',
        globalStartTime,
        globalEndTime: null,
        status: 'recording'
      });

      broadcastClipInfo(clipId, 'camera', globalStartTime, null, 'started');
      console.log('[useRecording] Started new video clip:', clipId);
    } catch (err) {
      console.error('[useRecording] Failed to start video clip:', err);
    }
  }, [
    isRecording,
    localRecordingStream,
    localClips,
    getClipRecorder,
    startClip,
    stopClip,
    finalizeClip,
    broadcastClipInfo
  ]);

  /**
   * Called when video is toggled OFF during recording.
   * Stops current video clip and starts an audio-only clip.
   */
  const onVideoDisabled = useCallback(
    async (getAudioOnlyStream: () => MediaStream | null) => {
      if (!isRecording) return;

      const clipRecorder = getClipRecorder();

      // Stop current video clip
      const videoClipId = clipRecorder.getActiveVideoClipId();
      if (videoClipId) {
        try {
          const { globalEndTime, blob } = await clipRecorder.stopClip(videoClipId);
          // Find by recordingId (videoClipId is the recorder's ID)
          const clip = localClips.find((c) => c.recordingId === videoClipId);
          const storeClipId = clip?.id || videoClipId;

          stopClip(storeClipId, globalEndTime);
          finalizeClip(storeClipId, blob);
          broadcastClipInfo(
            videoClipId,
            'camera',
            clip?.globalStartTime || 0,
            globalEndTime,
            'stopped'
          );

          console.log('[useRecording] Stopped video clip:', videoClipId);
        } catch (err) {
          console.error('[useRecording] Failed to stop video clip:', err);
        }
      }

      // Start audio-only clip to fill the gap
      const audioStream = getAudioOnlyStream();
      if (audioStream) {
        try {
          const { clipId, globalStartTime } = await clipRecorder.startAudioOnlyClip(audioStream);

          startClip({
            recordingId: clipId,
            peerId: selfId,
            sourceType: 'audio-only',
            globalStartTime,
            globalEndTime: null,
            status: 'recording'
          });

          broadcastClipInfo(clipId, 'audio-only', globalStartTime, null, 'started');
          activeAudioClipIdRef.current = clipId;
          console.log('[useRecording] Started audio-only clip:', clipId);
        } catch (err) {
          console.error('[useRecording] Failed to start audio-only clip:', err);
        }
      }
    },
    [isRecording, localClips, getClipRecorder, startClip, stopClip, finalizeClip, broadcastClipInfo]
  );

  /**
   * Reset recording state
   */
  const resetRecording = useCallback(() => {
    clipRecorderRef.current?.cleanup();
    screenRecorderRef.current?.cleanup();
    clearClips();
    reset();
  }, [clearClips, reset]);

  // Expose screen recorder for useScreenShare
  const getScreenRecorderInstance = useCallback(() => getScreenRecorder(), [getScreenRecorder]);

  return {
    isRecording,
    countdown,
    startTime,
    globalClockStart,
    startRecording,
    stopRecording,
    resetRecording,
    isHost,
    onVideoEnabled,
    onVideoDisabled,
    getScreenRecorderInstance
  };
}
