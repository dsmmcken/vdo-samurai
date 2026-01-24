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
  editPoints: EditPoint[];
  localBlob: Blob | null;

  setIsRecording: (recording: boolean) => void;
  setIsPaused: (paused: boolean) => void;
  setCountdown: (count: number | null) => void;
  setStartTime: (time: number | null) => void;
  setEndTime: (time: number | null) => void;
  setRecordingId: (id: string | null) => void;
  addEditPoint: (point: EditPoint) => void;
  clearEditPoints: () => void;
  setLocalBlob: (blob: Blob | null) => void;
  reset: () => void;
}

const initialState = {
  isRecording: false,
  isPaused: false,
  countdown: null,
  startTime: null,
  endTime: null,
  recordingId: null,
  editPoints: [],
  localBlob: null
};

export const useRecordingStore = create<RecordingState>((set) => ({
  ...initialState,

  setIsRecording: (isRecording) => set({ isRecording }),
  setIsPaused: (isPaused) => set({ isPaused }),
  setCountdown: (countdown) => set({ countdown }),
  setStartTime: (startTime) => set({ startTime }),
  setEndTime: (endTime) => set({ endTime }),
  setRecordingId: (recordingId) => set({ recordingId }),
  addEditPoint: (point) =>
    set((state) => ({
      editPoints: [...state.editPoints, point]
    })),
  clearEditPoints: () => set({ editPoints: [] }),
  setLocalBlob: (localBlob) => set({ localBlob }),
  reset: () => set(initialState)
}));
