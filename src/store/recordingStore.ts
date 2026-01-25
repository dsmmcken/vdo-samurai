import { create } from 'zustand';

export interface EditPoint {
  timestamp: number;
  focusedPeerId: string | null;
  type: 'focus-change' | 'marker';
}

interface RecordingState {
  isRecording: boolean;
  isPaused: boolean;
  countdown: number | null;
  startTime: number | null;
  endTime: number | null;
  recordingId: string | null;
  screenRecordingId: string | null;
  editPoints: EditPoint[];
  localBlob: Blob | null;
  localScreenBlob: Blob | null;

  setIsRecording: (recording: boolean) => void;
  setIsPaused: (paused: boolean) => void;
  setCountdown: (count: number | null) => void;
  setStartTime: (time: number | null) => void;
  setEndTime: (time: number | null) => void;
  setRecordingId: (id: string | null) => void;
  setScreenRecordingId: (id: string | null) => void;
  addEditPoint: (point: EditPoint) => void;
  clearEditPoints: () => void;
  setLocalBlob: (blob: Blob | null) => void;
  setLocalScreenBlob: (blob: Blob | null) => void;
  reset: () => void;
}

const initialState = {
  isRecording: false,
  isPaused: false,
  countdown: null,
  startTime: null,
  endTime: null,
  recordingId: null,
  screenRecordingId: null,
  editPoints: [],
  localBlob: null,
  localScreenBlob: null
};

export const useRecordingStore = create<RecordingState>((set) => ({
  ...initialState,

  setIsRecording: (isRecording) => set({ isRecording }),
  setIsPaused: (isPaused) => set({ isPaused }),
  setCountdown: (countdown) => set({ countdown }),
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
  reset: () => set(initialState)
}));
