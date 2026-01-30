import { contextBridge, ipcRenderer } from 'electron';

// Type definitions for IPC API
interface CompositeOptions {
  inputFiles: string[];
  outputPath: string;
  format: 'mp4' | 'webm';
  layout: 'grid' | 'focus' | 'pip';
}

interface CompositeResult {
  success: boolean;
  path?: string;
  error?: string;
}

interface StorageResult {
  success: boolean;
  error?: string;
}

interface ChunksResult extends StorageResult {
  chunks?: ArrayBuffer[];
}

interface FinalizeResult extends StorageResult {
  path?: string;
}

interface RecordingsResult extends StorageResult {
  recordings?: string[];
}

interface SaveDialogResult {
  canceled: boolean;
  filePath?: string;
}

interface VideoInfo {
  duration: number;
  width: number;
  height: number;
}

interface ScreenSource {
  id: string;
  name: string;
  thumbnail: string;
  displayId: string;
}

interface ScreenSourcesResult {
  success: boolean;
  sources?: ScreenSource[];
  error?: string;
}

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // FFmpeg operations
  ffmpeg: {
    composite: (options: CompositeOptions): Promise<CompositeResult> =>
      ipcRenderer.invoke('ffmpeg:composite', options),

    cancel: (): Promise<boolean> => ipcRenderer.invoke('ffmpeg:cancel'),

    onProgress: (callback: (progress: number) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, progress: number) => callback(progress);
      ipcRenderer.on('ffmpeg:progress-update', handler);
      return () => ipcRenderer.removeListener('ffmpeg:progress-update', handler);
    },

    trim: (
      inputPath: string,
      outputPath: string,
      startTime: number,
      duration: number,
      format: 'mp4' | 'webm'
    ): Promise<CompositeResult> =>
      ipcRenderer.invoke('ffmpeg:trim', inputPath, outputPath, startTime, duration, format),

    concatenate: (
      inputFiles: string[],
      outputPath: string,
      format: 'mp4' | 'webm'
    ): Promise<CompositeResult> =>
      ipcRenderer.invoke('ffmpeg:concatenate', inputFiles, outputPath, format),

    getVideoInfo: (inputPath: string): Promise<VideoInfo> =>
      ipcRenderer.invoke('ffmpeg:getVideoInfo', inputPath)
  },

  // Storage operations
  storage: {
    saveChunk: (
      recordingId: string,
      chunk: Uint8Array | ArrayBuffer,
      index: number
    ): Promise<StorageResult> => ipcRenderer.invoke('storage:saveChunk', recordingId, chunk, index),

    getChunks: (recordingId: string): Promise<ChunksResult> =>
      ipcRenderer.invoke('storage:getChunks', recordingId),

    finalizeRecording: (recordingId: string): Promise<FinalizeResult> =>
      ipcRenderer.invoke('storage:finalize', recordingId),

    deleteRecording: (recordingId: string): Promise<StorageResult> =>
      ipcRenderer.invoke('storage:deleteRecording', recordingId),

    listRecordings: (): Promise<RecordingsResult> => ipcRenderer.invoke('storage:listRecordings'),

    saveTempFile: (filename: string, buffer: ArrayBuffer): Promise<string> =>
      ipcRenderer.invoke('storage:saveTempFile', filename, buffer),

    getTempPath: (filename: string): Promise<string> =>
      ipcRenderer.invoke('storage:getTempPath', filename),

    readFile: (filePath: string): Promise<ArrayBuffer> =>
      ipcRenderer.invoke('storage:readFile', filePath),

    showSaveDialog: (defaultName: string): Promise<SaveDialogResult> =>
      ipcRenderer.invoke('storage:showSaveDialog', defaultName),

    saveFile: (filePath: string, buffer: ArrayBuffer): Promise<StorageResult> =>
      ipcRenderer.invoke('storage:saveFile', filePath, buffer)
  },

  // Screen capture
  screenCapture: {
    getSources: (): Promise<ScreenSourcesResult> => ipcRenderer.invoke('screen-capture:getSources')
  },

  // Mock media (for testing)
  mock: {
    getVideoFile: (videoType: string): Promise<ArrayBuffer> =>
      ipcRenderer.invoke('mock:getVideoFile', videoType)
  },

  // Window controls (for frameless windows on Linux)
  window: {
    minimize: (): Promise<void> => ipcRenderer.invoke('window:minimize'),
    maximize: (): Promise<void> => ipcRenderer.invoke('window:maximize'),
    close: (): Promise<void> => ipcRenderer.invoke('window:close'),
    isMaximized: (): Promise<boolean> => ipcRenderer.invoke('window:isMaximized')
  },

  // Platform info
  platform: process.platform,

  // App version
  getVersion: (): Promise<string> => ipcRenderer.invoke('app:getVersion')
});
