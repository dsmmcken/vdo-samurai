import { create } from 'zustand';
import type { RecordingClip } from '../types/recording';

export interface EditPoint {
  timestamp: number;
  focusedPeerId: string | null;
  type: 'focus-change' | 'marker';
}

export interface SpeedDialPlaybackRecord {
  clipId: string;
  clipName: string;
  clipPath: string;
  globalStartTime: number;
  globalEndTime: number | null;
}

interface RecordingState {
  // Session state
  isRecording: boolean;
  isPaused: boolean;
  countdown: number | null;
  sessionId: string | null;
  internalSessionId: string | null; // Unique ID for tracking recording sessions across peers

  // Global clock
  globalClockStart: number | null; // Host's Date.now() when recording started
  globalClockEnd: number | null; // Host's Date.now() when recording stopped
  clockOffset: number; // This peer's offset from host (ms)

  // Clip management
  localClips: RecordingClip[]; // Clips recorded by this peer
  activeClipId: string | null; // Currently recording clip ID
  peerClips: RecordingClip[]; // Clips from other peers

  // Legacy (kept for backwards compatibility)
  startTime: number | null;
  endTime: number | null;
  recordingId: string | null;
  editPoints: EditPoint[];
  localBlob: Blob | null;

  // Screen recording (unchanged from original)
  screenRecordingId: string | null;
  localScreenBlob: Blob | null;

  // Speed dial playbacks
  speedDialPlaybacks: SpeedDialPlaybackRecord[];

  // Actions
  setIsRecording: (recording: boolean) => void;
  setIsPaused: (paused: boolean) => void;
  setCountdown: (count: number | null) => void;
  setSessionId: (id: string | null) => void;
  setInternalSessionId: (id: string | null) => void;
  setGlobalClockStart: (time: number | null) => void;
  setGlobalClockEnd: (time: number | null) => void;
  setClockOffset: (offset: number) => void;

  // Clip actions
  startClip: (clip: Omit<RecordingClip, 'id'>) => string;
  stopClip: (clipId: string, globalEndTime: number) => void;
  finalizeClip: (clipId: string, blob: Blob) => void;
  addPeerClip: (clip: RecordingClip) => void;
  updatePeerClip: (clipId: string, updates: Partial<RecordingClip>) => void;
  setActiveClipId: (id: string | null) => void;
  clearClips: () => void;

  // Utility
  getGlobalTime: () => number;

  // Legacy actions
  setStartTime: (time: number | null) => void;
  setEndTime: (time: number | null) => void;
  setRecordingId: (id: string | null) => void;
  setScreenRecordingId: (id: string | null) => void;
  addEditPoint: (point: EditPoint) => void;
  clearEditPoints: () => void;
  setLocalBlob: (blob: Blob | null) => void;
  setLocalScreenBlob: (blob: Blob | null) => void;

  // Speed dial actions
  startSpeedDialPlayback: (
    clipId: string,
    clipName: string,
    clipPath: string,
    globalStartTime: number
  ) => void;
  stopSpeedDialPlayback: (clipId: string, globalEndTime: number) => void;
  clearSpeedDialPlaybacks: () => void;

  reset: () => void;
}

const initialState = {
  isRecording: false,
  isPaused: false,
  countdown: null,
  sessionId: null,
  internalSessionId: null as string | null,
  globalClockStart: null,
  globalClockEnd: null,
  clockOffset: 0,
  localClips: [] as RecordingClip[],
  activeClipId: null,
  peerClips: [] as RecordingClip[],
  startTime: null,
  endTime: null,
  recordingId: null,
  screenRecordingId: null,
  editPoints: [] as EditPoint[],
  localBlob: null,
  localScreenBlob: null,
  speedDialPlaybacks: [] as SpeedDialPlaybackRecord[]
};

let clipCounter = 0;

export const useRecordingStore = create<RecordingState>((set, get) => ({
  ...initialState,

  setIsRecording: (isRecording) => set({ isRecording }),
  setIsPaused: (isPaused) => set({ isPaused }),
  setCountdown: (countdown) => set({ countdown }),
  setSessionId: (sessionId) => set({ sessionId }),
  setInternalSessionId: (internalSessionId) => set({ internalSessionId }),
  setGlobalClockStart: (globalClockStart) => set({ globalClockStart }),
  setGlobalClockEnd: (globalClockEnd) => set({ globalClockEnd }),
  setClockOffset: (clockOffset) => set({ clockOffset }),

  // Start a new clip and return its ID
  startClip: (clipData) => {
    const id = `clip-${Date.now()}-${clipCounter++}`;
    const clip: RecordingClip = {
      ...clipData,
      id
    };
    set((state) => ({
      localClips: [...state.localClips, clip],
      activeClipId: clipData.sourceType !== 'audio-only' ? id : state.activeClipId
    }));
    return id;
  },

  // Stop a clip by setting its end time
  stopClip: (clipId, globalEndTime) => {
    set((state) => ({
      localClips: state.localClips.map((c) =>
        c.id === clipId ? { ...c, globalEndTime, status: 'stopped' as const } : c
      ),
      activeClipId: state.activeClipId === clipId ? null : state.activeClipId
    }));
  },

  // Finalize a clip with its blob
  finalizeClip: (clipId, blob) => {
    set((state) => ({
      localClips: state.localClips.map((c) =>
        c.id === clipId ? { ...c, blob, status: 'finalized' as const } : c
      )
    }));
  },

  // Add a clip from a peer
  addPeerClip: (clip) => {
    set((state) => ({
      peerClips: [...state.peerClips.filter((c) => c.id !== clip.id), clip]
    }));
  },

  // Update an existing peer clip
  updatePeerClip: (clipId, updates) => {
    set((state) => ({
      peerClips: state.peerClips.map((c) => (c.id === clipId ? { ...c, ...updates } : c))
    }));
  },

  setActiveClipId: (activeClipId) => set({ activeClipId }),

  clearClips: () => set({ localClips: [], peerClips: [], activeClipId: null }),

  // Get current global time (adjusted for clock offset)
  getGlobalTime: () => {
    const { globalClockStart, clockOffset } = get();
    if (globalClockStart === null) return 0;
    return Date.now() - clockOffset - globalClockStart;
  },

  // Legacy actions
  setStartTime: (startTime) => set({ startTime }),
  setEndTime: (endTime) => set({ endTime }),
  setRecordingId: (recordingId) => set({ recordingId }),
  setScreenRecordingId: (screenRecordingId) => set({ screenRecordingId }),
  addEditPoint: (point) =>
    set((state) => ({
      editPoints: [...state.editPoints, point]
    })),
  clearEditPoints: () => set({ editPoints: [] }),
  setLocalBlob: (localBlob) => set({ localBlob }),
  setLocalScreenBlob: (localScreenBlob) => set({ localScreenBlob }),

  // Speed dial playback tracking
  startSpeedDialPlayback: (clipId, clipName, clipPath, globalStartTime) =>
    set((state) => ({
      speedDialPlaybacks: [
        ...state.speedDialPlaybacks,
        { clipId, clipName, clipPath, globalStartTime, globalEndTime: null }
      ]
    })),

  stopSpeedDialPlayback: (clipId, globalEndTime) =>
    set((state) => ({
      speedDialPlaybacks: state.speedDialPlaybacks.map((p) =>
        p.clipId === clipId && p.globalEndTime === null ? { ...p, globalEndTime } : p
      )
    })),

  clearSpeedDialPlaybacks: () => set({ speedDialPlaybacks: [] }),

  reset: () => {
    clipCounter = 0;
    set(initialState);
  }
}));
