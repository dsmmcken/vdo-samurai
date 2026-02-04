import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { SpeedDialClip } from '../types/speeddial';

interface SpeedDialState {
  // Persisted state
  clips: SpeedDialClip[];
  volume: number; // 0-1

  // Non-persisted state (transient)
  isPlaying: boolean;
  activeClipId: string | null;
  isPanelOpen: boolean;

  // Actions
  addClip: (clip: SpeedDialClip) => void;
  removeClip: (id: string) => void;
  reorderClips: (fromIndex: number, toIndex: number) => void;
  updateClipThumbnail: (id: string, thumbnailUrl: string) => void;
  startPlayback: (clipId: string) => void;
  stopPlayback: () => void;
  setVolume: (volume: number) => void;
  setPanelOpen: (open: boolean) => void;
  getClipByIndex: (index: number) => SpeedDialClip | null;
  reset: () => void;
}

const initialState = {
  clips: [],
  volume: 0.8,
  isPlaying: false,
  activeClipId: null,
  isPanelOpen: false
};

export const useSpeedDialStore = create<SpeedDialState>()(
  persist(
    (set, get) => ({
      ...initialState,

      addClip: (clip) =>
        set((state) => ({
          clips: [...state.clips, clip]
        })),

      removeClip: (id) =>
        set((state) => ({
          clips: state.clips.filter((c) => c.id !== id),
          // Stop playback if removing the active clip
          ...(state.activeClipId === id ? { isPlaying: false, activeClipId: null } : {})
        })),

      reorderClips: (fromIndex, toIndex) =>
        set((state) => {
          const newClips = [...state.clips];
          const [removed] = newClips.splice(fromIndex, 1);
          newClips.splice(toIndex, 0, removed);
          return { clips: newClips };
        }),

      updateClipThumbnail: (id, thumbnailUrl) =>
        set((state) => ({
          clips: state.clips.map((c) => (c.id === id ? { ...c, thumbnailUrl } : c))
        })),

      startPlayback: (clipId) =>
        set({
          isPlaying: true,
          activeClipId: clipId
        }),

      stopPlayback: () =>
        set({
          isPlaying: false,
          activeClipId: null
        }),

      setVolume: (volume) =>
        set({
          volume: Math.max(0, Math.min(1, volume))
        }),

      setPanelOpen: (open) =>
        set({
          isPanelOpen: open
        }),

      getClipByIndex: (index) => {
        const { clips } = get();
        return clips[index] ?? null;
      },

      reset: () =>
        set({
          isPlaying: false,
          activeClipId: null,
          isPanelOpen: false
        })
    }),
    {
      name: 'vdo-samurai-speeddial',
      // Only persist clips and volume, not transient state
      partialize: (state) => ({
        clips: state.clips,
        volume: state.volume
      })
    }
  )
);
