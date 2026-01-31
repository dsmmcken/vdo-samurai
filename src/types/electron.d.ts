/**
 * Type definitions for Electron IPC API exposed via contextBridge
 */

export interface CompositeOptions {
  inputFiles: string[];
  outputPath: string;
  format: 'mp4' | 'webm';
  layout: 'grid' | 'focus' | 'pip';
}

export interface CompositeResult {
  success: boolean;
  path?: string;
  error?: string;
}

export interface StorageResult {
  success: boolean;
  error?: string;
}

export interface ChunksResult extends StorageResult {
  chunks?: ArrayBuffer[];
}

export interface FinalizeResult extends StorageResult {
  path?: string;
}

export interface RecordingsResult extends StorageResult {
  recordings?: string[];
}

export interface SaveDialogResult {
  canceled: boolean;
  filePath?: string;
}

export interface VideoInfo {
  duration: number;
  width: number;
  height: number;
}

// Timeline export types
export type ExportLayout = 'screen-pip' | 'camera-only' | 'screen-only';

export interface ExportSourceRef {
  sourceIndex: number;
  trimStartMs: number;
  trimEndMs: number;
}

export interface ExportSegment {
  id: string;
  startTimeMs: number;
  endTimeMs: number;
  peerId: string | null;
  peerName: string;
  layout: ExportLayout;
  camera?: ExportSourceRef;
  screen?: ExportSourceRef;
}

export interface TimelineExportOptions {
  inputFiles: string[];
  outputPath: string;
  format: 'mp4' | 'webm';
  segments: ExportSegment[];
  sourceCount: number;
  transitionDurationMs: number;
}

export interface TimelineExportResult {
  success: boolean;
  path?: string;
  error?: string;
}

export interface ScreenSource {
  id: string;
  name: string;
  thumbnail: string;
  displayId: string;
}

export interface ScreenSourcesResult {
  success: boolean;
  sources?: ScreenSource[];
  error?: string;
}

export interface ElectronAPI {
  ffmpeg: {
    composite: (options: CompositeOptions) => Promise<CompositeResult>;
    cancel: () => Promise<boolean>;
    onProgress: (callback: (progress: number) => void) => () => void;
    trim: (
      inputPath: string,
      outputPath: string,
      startTime: number,
      duration: number,
      format: 'mp4' | 'webm'
    ) => Promise<CompositeResult>;
    concatenate: (
      inputFiles: string[],
      outputPath: string,
      format: 'mp4' | 'webm'
    ) => Promise<CompositeResult>;
    getVideoInfo: (inputPath: string) => Promise<VideoInfo>;
    // Timeline-aware export
    compositeTimeline: (options: TimelineExportOptions) => Promise<TimelineExportResult>;
    cancelTimeline: () => Promise<boolean>;
  };
  storage: {
    saveChunk: (
      recordingId: string,
      chunk: Uint8Array | ArrayBuffer,
      index: number
    ) => Promise<StorageResult>;
    getChunks: (recordingId: string) => Promise<ChunksResult>;
    finalizeRecording: (recordingId: string) => Promise<FinalizeResult>;
    deleteRecording: (recordingId: string) => Promise<StorageResult>;
    listRecordings: () => Promise<RecordingsResult>;
    saveTempFile: (filename: string, buffer: ArrayBuffer) => Promise<string>;
    getTempPath: (filename: string) => Promise<string>;
    readFile: (filePath: string) => Promise<ArrayBuffer>;
    showSaveDialog: (defaultName: string) => Promise<SaveDialogResult>;
    saveFile: (filePath: string, buffer: ArrayBuffer) => Promise<StorageResult>;
  };
  screenCapture: {
    getSources: () => Promise<ScreenSourcesResult>;
  };
  window: {
    minimize: () => Promise<void>;
    maximize: () => Promise<void>;
    close: () => Promise<void>;
    isMaximized: () => Promise<boolean>;
  };
  platform: NodeJS.Platform;
  getVersion: () => Promise<string>;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};
