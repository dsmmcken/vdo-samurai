import { useCallback, useEffect, useRef } from 'react';
import { useSpeedDialStore } from '../store/speedDialStore';
import { useSessionStore } from '../store/sessionStore';
import { usePeerManager } from './usePeerManager';
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

  const { setLocalScreenStream } = useSessionStore();
  const { addLocalStream, removeLocalStream } = usePeerManager();
  const { changeFocus } = useFocus();

  const playerRef = useRef<SpeedDialPlayer | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const activeClipIdRef = useRef<string | null>(null);

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
      removeLocalStream(streamRef.current, true);
      streamRef.current = null;
    }

    // Clear local screen stream display
    setLocalScreenStream(null);

    // Update store state
    stopPlayback();
    activeClipIdRef.current = null;
  }, [removeLocalStream, setLocalScreenStream, stopPlayback, onPlaybackEndedDuringRecording]);

  // Play a specific clip
  const playClip = useCallback(
    async (clip: SpeedDialClip) => {
      const player = getPlayer();

      // Stop any existing playback first
      if (isPlaying && streamRef.current) {
        if (activeClipIdRef.current) {
          onPlaybackEndedDuringRecording?.(activeClipIdRef.current);
        }
        removeLocalStream(streamRef.current, true);
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

        // Display locally as screen stream
        setLocalScreenStream(stream);
        console.log('[useSpeedDial] Set localScreenStream');

        // Add to P2P as screen type (will be transmitted to all peers)
        addLocalStream(stream, { type: 'screen' });

        // Focus participants on us (host) when speed dial starts
        // null means focus on self/host, which will show the screen stream
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
      addLocalStream,
      removeLocalStream,
      setLocalScreenStream,
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
      removeLocalStream(streamRef.current, true);
      streamRef.current = null;
    }

    // Clear local display
    setLocalScreenStream(null);

    // Update store
    stopPlayback();
    activeClipIdRef.current = null;
  }, [removeLocalStream, setLocalScreenStream, stopPlayback, onPlaybackEndedDuringRecording]);

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

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (playerRef.current) {
        playerRef.current.destroy();
        playerRef.current = null;
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
    };
  }, []);

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
