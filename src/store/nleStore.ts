import { create } from 'zustand';

export interface NLEClip {
  id: string;
  peerId: string | null; // null = local user
  peerName: string;
  startTime: number; // relative to recording start (ms) - for legacy clips from edit points
  endTime: number;
  order: number; // position in timeline
  trimStart: number; // trim from beginning (ms)
  trimEnd: number; // trim from end (ms)
  color: string; // Tailwind color name
  sourceType: 'camera' | 'screen' | 'audio-only'; // Type of recording source
  globalStartTime?: number; // Global start time from clip-based recording
  globalEndTime?: number;   // Global end time from clip-based recording
  recordingId?: string;     // Reference to the recording blob
}

export type NLEMode = 'session' | 'editing';

interface NLEState {
  mode: NLEMode;
  clips: NLEClip[];
  playheadPosition: number;
  selectedClipId: string | null;
  totalDuration: number;
  isPlaying: boolean;
  zoom: number; // pixels per second

  // Actions
  setMode: (mode: NLEMode) => void;
  initializeClips: (clips: NLEClip[]) => void;
  addClip: (clip: NLEClip) => void;
  updateClip: (clipId: string, updates: Partial<NLEClip>) => void;
  deleteClip: (clipId: string) => void;
  reorderClips: (clipIds: string[]) => void;
  splitClip: (clipId: string, splitTime: number) => void;
  trimClip: (clipId: string, trimStart: number, trimEnd: number) => void;
  setPlayheadPosition: (position: number) => void;
  setSelectedClipId: (clipId: string | null) => void;
  setIsPlaying: (playing: boolean) => void;
  setZoom: (zoom: number) => void;
  setZoomToFit: (containerWidth: number) => void;
  calculateTotalDuration: () => void;
  reset: () => void;
}

const initialState = {
  mode: 'session' as NLEMode,
  clips: [] as NLEClip[],
  playheadPosition: 0,
  selectedClipId: null as string | null,
  totalDuration: 0,
  isPlaying: false,
  zoom: 100, // 100 pixels per second
};

export const useNLEStore = create<NLEState>((set, get) => ({
  ...initialState,

  setMode: (mode) => set({ mode }),

  initializeClips: (clips) => {
    set({ clips });
    get().calculateTotalDuration();
  },

  addClip: (clip) =>
    set((state) => {
      const newClips = [...state.clips, clip];
      return { clips: newClips };
    }),

  updateClip: (clipId, updates) =>
    set((state) => ({
      clips: state.clips.map((c) => (c.id === clipId ? { ...c, ...updates } : c)),
    })),

  deleteClip: (clipId) =>
    set((state) => {
      const newClips = state.clips.filter((c) => c.id !== clipId);
      // Reorder remaining clips
      const reordered = newClips.map((c, i) => ({ ...c, order: i }));
      return {
        clips: reordered,
        selectedClipId: state.selectedClipId === clipId ? null : state.selectedClipId,
      };
    }),

  reorderClips: (clipIds) =>
    set((state) => {
      const clipMap = new Map(state.clips.map((c) => [c.id, c]));
      const reordered = clipIds
        .map((id, index) => {
          const clip = clipMap.get(id);
          return clip ? { ...clip, order: index } : null;
        })
        .filter((c): c is NLEClip => c !== null);
      return { clips: reordered };
    }),

  splitClip: (clipId, splitTime) =>
    set((state) => {
      const clipIndex = state.clips.findIndex((c) => c.id === clipId);
      if (clipIndex === -1) return state;

      const clip = state.clips[clipIndex];
      const clipDuration = clip.endTime - clip.startTime - clip.trimStart - clip.trimEnd;

      // splitTime is relative to the clip's visible start
      if (splitTime <= 0 || splitTime >= clipDuration) return state;

      const actualSplitTime = clip.startTime + clip.trimStart + splitTime;

      // Create two new clips from the split
      const clip1: NLEClip = {
        ...clip,
        id: `${clip.id}-a`,
        endTime: actualSplitTime,
        trimEnd: 0,
      };

      const clip2: NLEClip = {
        ...clip,
        id: `${clip.id}-b`,
        startTime: actualSplitTime,
        trimStart: 0,
        order: clip.order + 1,
      };

      // Insert the new clips and remove the old one
      const newClips = [...state.clips];
      newClips.splice(clipIndex, 1, clip1, clip2);

      // Update order for clips after the split
      const reordered = newClips.map((c, i) => ({ ...c, order: i }));

      return { clips: reordered };
    }),

  trimClip: (clipId, trimStart, trimEnd) =>
    set((state) => ({
      clips: state.clips.map((c) => (c.id === clipId ? { ...c, trimStart, trimEnd } : c)),
    })),

  setPlayheadPosition: (position) => set({ playheadPosition: Math.max(0, position) }),

  setSelectedClipId: (clipId) => set({ selectedClipId: clipId }),

  setIsPlaying: (playing) => set({ isPlaying: playing }),

  setZoom: (zoom) => set({ zoom: Math.max(10, Math.min(500, zoom)) }),

  setZoomToFit: (containerWidth) => {
    const { totalDuration } = get();
    if (totalDuration <= 0 || containerWidth <= 0) return;
    // Calculate zoom so that totalDuration fills containerWidth
    // zoom is pixels per second, so: containerWidth = totalDuration * (zoom / 1000)
    // Solving: zoom = (containerWidth * 1000) / totalDuration
    const optimalZoom = (containerWidth * 1000) / totalDuration;
    // Clamp to valid range
    set({ zoom: Math.max(10, Math.min(500, optimalZoom)) });
  },

  calculateTotalDuration: () => {
    const { clips } = get();
    const total = clips.reduce((acc, clip) => {
      const clipDuration = clip.endTime - clip.startTime - clip.trimStart - clip.trimEnd;
      return acc + clipDuration;
    }, 0);
    set({ totalDuration: total });
  },

  reset: () => set(initialState),
}));

// Utility functions for working with clips
export function getClipDuration(clip: NLEClip): number {
  return clip.endTime - clip.startTime - clip.trimStart - clip.trimEnd;
}

export function getClipAtPlayhead(clips: NLEClip[], playheadPosition: number): NLEClip | null {
  let accumulated = 0;
  const sortedClips = [...clips].sort((a, b) => a.order - b.order);

  for (const clip of sortedClips) {
    const duration = getClipDuration(clip);
    if (playheadPosition >= accumulated && playheadPosition < accumulated + duration) {
      return clip;
    }
    accumulated += duration;
  }
  return null;
}

export function getTimeInClip(clip: NLEClip, playheadPosition: number, clips: NLEClip[]): number {
  let accumulated = 0;
  const sortedClips = [...clips].sort((a, b) => a.order - b.order);

  for (const c of sortedClips) {
    if (c.id === clip.id) {
      const relativePosition = playheadPosition - accumulated;
      return clip.startTime + clip.trimStart + relativePosition;
    }
    accumulated += getClipDuration(c);
  }
  return clip.startTime + clip.trimStart;
}
