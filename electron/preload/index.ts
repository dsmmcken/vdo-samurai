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

// Timeline export types
type ExportLayout = 'screen-pip' | 'camera-only' | 'screen-only';

interface ExportSourceRef {
  sourceIndex: number;
  trimStartMs: number;
  trimEndMs: number;
}

interface ExportSegment {
  id: string;
  startTimeMs: number;
  endTimeMs: number;
  peerId: string | null;
  peerName: string;
  layout: ExportLayout;
  camera?: ExportSourceRef;
  screen?: ExportSourceRef;
}

interface TimelineExportOptions {
  inputFiles: string[];
  outputPath: string;
  format: 'mp4' | 'webm';
  segments: ExportSegment[];
  sourceCount: number;
  transitionDurationMs: number;
}

interface TimelineExportResult {
  success: boolean;
  path?: string;
  error?: string;
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

// Speed Dial types
interface SpeedDialClipInfo {
  path: string;
  name: string;
  duration: number;
}

interface SpeedDialImportResult {
  success: boolean;
  clip?: SpeedDialClipInfo;
  error?: string;
}

interface SpeedDialThumbnailResult {
  success: boolean;
  thumbnailPath?: string;
  error?: string;
}

interface SpeedDialVideoInfo {
  success: boolean;
  duration?: number;
  width?: number;
  height?: number;
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
      ipcRenderer.invoke('ffmpeg:getVideoInfo', inputPath),

    // Timeline-aware export
    compositeTimeline: (options: TimelineExportOptions): Promise<TimelineExportResult> =>
      ipcRenderer.invoke('ffmpeg:compositeTimeline', options),

    cancelTimeline: (): Promise<boolean> => ipcRenderer.invoke('ffmpeg:cancelTimeline')
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
  getVersion: (): Promise<string> => ipcRenderer.invoke('app:getVersion'),

  // Speed Dial operations
  speedDial: {
    importClip: (): Promise<SpeedDialImportResult> => ipcRenderer.invoke('speeddial:importClip'),

    readClip: (filePath: string): Promise<ArrayBuffer> =>
      ipcRenderer.invoke('speeddial:readClip', filePath),

    generateThumbnail: (videoPath: string): Promise<SpeedDialThumbnailResult> =>
      ipcRenderer.invoke('speeddial:generateThumbnail', videoPath),

    getVideoInfo: (videoPath: string): Promise<SpeedDialVideoInfo> =>
      ipcRenderer.invoke('speeddial:getVideoInfo', videoPath),

    checkFileExists: (filePath: string): Promise<boolean> =>
      ipcRenderer.invoke('speeddial:checkFileExists', filePath),

    getMediaServerPort: (): Promise<number> => ipcRenderer.invoke('speeddial:getMediaServerPort'),

    getMediaServerToken: (): Promise<string> => ipcRenderer.invoke('speeddial:getMediaServerToken'),

    // Clip registry for media:// protocol
    registerClip: (filePath: string): Promise<string> =>
      ipcRenderer.invoke('speeddial:registerClip', filePath),

    unregisterClip: (clipId: string): Promise<void> =>
      ipcRenderer.invoke('speeddial:unregisterClip', clipId)
  }
});
