import { useCallback, useEffect, useRef } from 'react';
import { useSpeedDialStore } from '../store/speedDialStore';
import { useSessionStore } from '../store/sessionStore';
import { useTrystero } from '../contexts/TrysteroContext';
import { useFocus } from './useFocus';
import { SpeedDialPlayer } from '../services/SpeedDialPlayer';
import type { SpeedDialClip } from '../types/speeddial';

interface UseSpeedDialOptions {
  /** Called when speed dial playback starts during recording */
  onPlaybackStartedDuringRecording?: (clipId: string) => void;
  /** Called when speed dial playback ends during recording */
  onPlaybackEndedDuringRecording?: (clipId: string) => void;
}

export function useSpeedDial(options: UseSpeedDialOptions = {}) {
  const { onPlaybackStartedDuringRecording, onPlaybackEndedDuringRecording } = options;

  const {
    clips,
    volume,
    isPlaying,
    activeClipId,
    isPanelOpen,
    addClip,
    removeClip,
    reorderClips,
    updateClipThumbnail,
    startPlayback,
    stopPlayback,
    setVolume,
    setPanelOpen,
    getClipByIndex
  } = useSpeedDialStore();

  const { setLocalSpeedDialStream } = useSessionStore();
  const { addSpeedDialStream, removeSpeedDialStream, broadcastSpeedDialStatus } = useTrystero();
  const { changeFocus } = useFocus();

  const playerRef = useRef<SpeedDialPlayer | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const activeClipIdRef = useRef<string | null>(null);

  // Ref to access the latest callback during cleanup without adding it to effect deps
  const onPlaybackEndedRef = useRef(onPlaybackEndedDuringRecording);
  onPlaybackEndedRef.current = onPlaybackEndedDuringRecording;

  // Create player instance lazily
  const getPlayer = useCallback(() => {
    if (!playerRef.current) {
      playerRef.current = new SpeedDialPlayer();
    }
    return playerRef.current;
  }, []);

  // Handle natural playback end
  const handlePlaybackEnd = useCallback(() => {
    console.log('[useSpeedDial] Playback ended naturally');

    // Notify recording if active
    if (activeClipIdRef.current) {
      onPlaybackEndedDuringRecording?.(activeClipIdRef.current);
    }

    // Clean up stream from P2P
    if (streamRef.current) {
      removeSpeedDialStream(streamRef.current);
      streamRef.current = null;
    }

    // Clear local speed dial stream display
    setLocalSpeedDialStream(null);

    // Broadcast that speed dial stopped
    broadcastSpeedDialStatus(false);

    // Update store state
    stopPlayback();
    activeClipIdRef.current = null;
  }, [
    removeSpeedDialStream,
    setLocalSpeedDialStream,
    broadcastSpeedDialStatus,
    stopPlayback,
    onPlaybackEndedDuringRecording
  ]);

  // Play a specific clip
  const playClip = useCallback(
    async (clip: SpeedDialClip) => {
      const player = getPlayer();

      // Stop any existing playback first
      if (isPlaying && streamRef.current) {
        if (activeClipIdRef.current) {
          onPlaybackEndedDuringRecording?.(activeClipIdRef.current);
        }
        removeSpeedDialStream(streamRef.current);
        broadcastSpeedDialStatus(false);
        streamRef.current = null;
        player.stop();
      }

      try {
        console.log('[useSpeedDial] Loading clip:', clip.name);

        // Check if file still exists
        if (window.electronAPI?.speedDial) {
          const exists = await window.electronAPI.speedDial.checkFileExists(clip.path);
          if (!exists) {
            console.error('[useSpeedDial] Clip file not found:', clip.path);
            throw new Error(`File not found: ${clip.path}`);
          }
        }

        // Load and play the clip
        await player.loadClip(clip.path);
        player.setVolume(volume);
        player.setOnPlaybackEnd(handlePlaybackEnd);

        const stream = await player.play();
        streamRef.current = stream;
        activeClipIdRef.current = clip.id;

        console.log('[useSpeedDial] Got stream from player:', {
          videoTracks: stream.getVideoTracks().length,
          audioTracks: stream.getAudioTracks().length,
          active: stream.active
        });

        // Order matters for reliable stream classification!
        // 1. Tell peers first (sets fallback flag before stream arrives)
        broadcastSpeedDialStatus(true);
        console.log('[useSpeedDial] Broadcasted speed dial status: true');

        // 2. Add stream to P2P as speeddial type
        addSpeedDialStream(stream);
        console.log('[useSpeedDial] Added speed dial stream to P2P');

        // 3. Update local state for display
        setLocalSpeedDialStream(stream);
        console.log('[useSpeedDial] Set localSpeedDialStream');

        // 4. Focus participants on us (host) when speed dial starts
        // null means focus on self/host, which will show the speed dial stream
        changeFocus(null);

        // Update store state
        startPlayback(clip.id);

        // Notify recording if active
        onPlaybackStartedDuringRecording?.(clip.id);

        console.log('[useSpeedDial] Playing clip:', clip.name);
      } catch (err) {
        console.error('[useSpeedDial] Failed to play clip:', err);
        activeClipIdRef.current = null;
        throw err;
      }
    },
    [
      getPlayer,
      isPlaying,
      volume,
      handlePlaybackEnd,
      addSpeedDialStream,
      removeSpeedDialStream,
      broadcastSpeedDialStatus,
      setLocalSpeedDialStream,
      changeFocus,
      startPlayback,
      onPlaybackStartedDuringRecording,
      onPlaybackEndedDuringRecording
    ]
  );

  // Play clip by index (for keyboard shortcuts)
  const playClipByIndex = useCallback(
    async (index: number) => {
      const clip = getClipByIndex(index);
      if (clip) {
        await playClip(clip);
      }
    },
    [getClipByIndex, playClip]
  );

  // Stop current playback
  const stopCurrentPlayback = useCallback(() => {
    const player = playerRef.current;
    if (!player) return;

    console.log('[useSpeedDial] Stopping playback');

    // Notify recording before stopping
    if (activeClipIdRef.current) {
      onPlaybackEndedDuringRecording?.(activeClipIdRef.current);
    }

    player.stop();

    // Remove stream from P2P
    if (streamRef.current) {
      removeSpeedDialStream(streamRef.current);
      streamRef.current = null;
    }

    // Clear local display
    setLocalSpeedDialStream(null);

    // Broadcast that speed dial stopped
    broadcastSpeedDialStatus(false);

    // Update store
    stopPlayback();
    activeClipIdRef.current = null;
  }, [
    removeSpeedDialStream,
    setLocalSpeedDialStream,
    broadcastSpeedDialStatus,
    stopPlayback,
    onPlaybackEndedDuringRecording
  ]);

  // Import a new clip
  const importNewClip = useCallback(async () => {
    if (!window.electronAPI?.speedDial) {
      console.error('[useSpeedDial] Speed Dial requires Electron');
      return null;
    }

    const result = await window.electronAPI.speedDial.importClip();
    if (!result.success || !result.clip) {
      if (result.error !== 'cancelled') {
        console.error('[useSpeedDial] Failed to import clip:', result.error);
      }
      return null;
    }

    const clip: SpeedDialClip = {
      id: `sd-${Date.now()}`,
      name: result.clip.name,
      path: result.clip.path,
      thumbnailUrl: null,
      duration: result.clip.duration
    };

    addClip(clip);

    // Generate thumbnail in background
    window.electronAPI.speedDial.generateThumbnail(clip.path).then((thumbResult) => {
      if (thumbResult.success && thumbResult.thumbnailPath) {
        // Convert file path to file:// URL for display
        updateClipThumbnail(clip.id, `file://${thumbResult.thumbnailPath}`);
      }
    });

    return clip;
  }, [addClip, updateClipThumbnail]);

  // Update volume when it changes
  useEffect(() => {
    if (playerRef.current) {
      playerRef.current.setVolume(volume);
    }
  }, [volume]);

  // Cleanup on unmount - must remove stream from P2P and notify peers
  // This handles cases like host transfer where the panel unmounts while playing
  useEffect(() => {
    return () => {
      // Notify recording that speed dial playback ended (if active during recording)
      // Uses ref to access the latest callback without adding it to effect deps
      if (activeClipIdRef.current) {
        onPlaybackEndedRef.current?.(activeClipIdRef.current);
        activeClipIdRef.current = null;
      }

      // Remove speed dial stream from P2P before destroying player
      if (streamRef.current) {
        removeSpeedDialStream(streamRef.current);
      }

      // Notify peers that speed dial stopped
      broadcastSpeedDialStatus(false);

      // Clear local display state
      setLocalSpeedDialStream(null);

      if (playerRef.current) {
        playerRef.current.destroy();
        playerRef.current = null;
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
    };
    // These deps are all referentially stable (useCallback with [] deps or Zustand actions)
    // onPlaybackEndedRef is accessed via ref, so it doesn't need to be in the dep array
  }, [removeSpeedDialStream, broadcastSpeedDialStatus, setLocalSpeedDialStream]);

  return {
    // State
    clips,
    volume,
    isPlaying,
    activeClipId,
    isPanelOpen,

    // Actions
    playClip,
    playClipByIndex,
    stopPlayback: stopCurrentPlayback,
    importClip: importNewClip,
    removeClip,
    reorderClips,
    setVolume,
    setPanelOpen
  };
}
