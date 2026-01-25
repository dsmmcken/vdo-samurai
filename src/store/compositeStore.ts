import { create } from 'zustand';
import type { CompositeStatus } from '../services/compositing';
import type { OutputFormat } from '../services/compositing/config';

interface CompositeStore {
  // State
  status: CompositeStatus;
  progress: number;
  message: string;
  outputBlob: Blob | null;
  outputUrl: string | null;
  error: string | null;

  // Settings
  outputFormat: OutputFormat;
  layout: 'focus' | 'grid' | 'pip';

  // Actions
  setStatus: (status: CompositeStatus) => void;
  setProgress: (progress: number, message?: string) => void;
  setOutputBlob: (blob: Blob | null) => void;
  setError: (error: string | null) => void;
  setOutputFormat: (format: OutputFormat) => void;
  setLayout: (layout: 'focus' | 'grid' | 'pip') => void;
  reset: () => void;
}

export const useCompositeStore = create<CompositeStore>((set, get) => ({
  // Initial state
  status: 'idle',
  progress: 0,
  message: '',
  outputBlob: null,
  outputUrl: null,
  error: null,
  outputFormat: 'mp4',
  layout: 'grid',

  setStatus: (status) => set({ status }),

  setProgress: (progress, message) =>
    set({
      progress,
      ...(message !== undefined ? { message } : {})
    }),

  setOutputBlob: (blob) => {
    // Revoke old URL if exists
    const oldUrl = get().outputUrl;
    if (oldUrl) {
      URL.revokeObjectURL(oldUrl);
    }

    const newUrl = blob ? URL.createObjectURL(blob) : null;
    set({
      outputBlob: blob,
      outputUrl: newUrl
    });
  },

  setError: (error) => set({ error }),

  setOutputFormat: (format) => set({ outputFormat: format }),

  setLayout: (layout) => set({ layout }),

  reset: () => {
    const oldUrl = get().outputUrl;
    if (oldUrl) {
      URL.revokeObjectURL(oldUrl);
    }

    set({
      status: 'idle',
      progress: 0,
      message: '',
      outputBlob: null,
      outputUrl: null,
      error: null
    });
  }
}));
