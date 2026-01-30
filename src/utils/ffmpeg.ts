import { COMPOSITE_CONFIG } from './compositeConfig';

type ProgressCallback = (progress: number, message: string) => void;

export class FFmpegService {
  private progressCallback: ProgressCallback | null = null;
  private progressUnsubscribe: (() => void) | null = null;
  private ready = false;

  /**
   * Check if native FFmpeg is available via Electron IPC
   */
  static isSupported(): boolean {
    return typeof window !== 'undefined' && typeof window.electronAPI !== 'undefined';
  }

  async load(): Promise<void> {
    if (this.ready) return;

    // In Electron, FFmpeg is always available via native binaries
    if (!FFmpegService.isSupported()) {
      throw new Error('Electron API not available. This app must run in Electron.');
    }

    // Set up progress listener
    this.progressUnsubscribe = window.electronAPI.ffmpeg.onProgress((progress: number) => {
      const percent = Math.round(progress * 100);
      this.progressCallback?.(progress, `Processing: ${percent}%`);
    });

    this.ready = true;
    console.log('FFmpeg service ready (native)');
  }

  isLoaded(): boolean {
    return this.ready;
  }

  onProgress(callback: ProgressCallback): void {
    this.progressCallback = callback;
  }

  async compositeSimple(
    inputFiles: { name: string; blob: Blob }[],
    outputName: string,
    format: 'webm' | 'mp4' = 'webm'
  ): Promise<Blob> {
    if (!FFmpegService.isSupported()) {
      throw new Error('Electron API not available');
    }

    const formatConfig = COMPOSITE_CONFIG.OUTPUT_FORMATS[format];

    // Save input blobs to temp files
    const tempPaths: string[] = [];
    for (let i = 0; i < inputFiles.length; i++) {
      const file = inputFiles[i];
      const buffer = await file.blob.arrayBuffer();
      const tempPath = await window.electronAPI.storage.saveTempFile(`input_${i}.webm`, buffer);
      tempPaths.push(tempPath);
    }

    // Get output path
    const outputPath = await window.electronAPI.storage.getTempPath(outputName);

    // Run FFmpeg composite via IPC
    const result = await window.electronAPI.ffmpeg.composite({
      inputFiles: tempPaths,
      outputPath,
      format,
      layout: 'grid'
    });

    if (!result.success) {
      throw new Error(result.error || 'FFmpeg composite failed');
    }

    // Read output file as blob
    const outputBuffer = await window.electronAPI.storage.readFile(result.path!);
    return new Blob([outputBuffer], { type: formatConfig.mimeType });
  }

  async compositeWithLayout(
    inputFiles: { name: string; blob: Blob }[],
    outputName: string,
    format: 'webm' | 'mp4',
    layout: 'grid' | 'focus' | 'pip'
  ): Promise<Blob> {
    if (!FFmpegService.isSupported()) {
      throw new Error('Electron API not available');
    }

    const formatConfig = COMPOSITE_CONFIG.OUTPUT_FORMATS[format];

    // Save input blobs to temp files
    const tempPaths: string[] = [];
    for (let i = 0; i < inputFiles.length; i++) {
      const file = inputFiles[i];
      const buffer = await file.blob.arrayBuffer();
      const tempPath = await window.electronAPI.storage.saveTempFile(`input_${i}.webm`, buffer);
      tempPaths.push(tempPath);
    }

    // Get output path
    const outputPath = await window.electronAPI.storage.getTempPath(outputName);

    // Run FFmpeg composite via IPC
    const result = await window.electronAPI.ffmpeg.composite({
      inputFiles: tempPaths,
      outputPath,
      format,
      layout
    });

    if (!result.success) {
      throw new Error(result.error || 'FFmpeg composite failed');
    }

    // Read output file as blob
    const outputBuffer = await window.electronAPI.storage.readFile(result.path!);
    return new Blob([outputBuffer], { type: formatConfig.mimeType });
  }

  async concatenateVideos(
    inputFiles: { name: string; blob: Blob }[],
    outputName: string,
    format: 'webm' | 'mp4' = 'webm'
  ): Promise<Blob> {
    if (!FFmpegService.isSupported()) {
      throw new Error('Electron API not available');
    }

    const formatConfig = COMPOSITE_CONFIG.OUTPUT_FORMATS[format];

    // Save input blobs to temp files
    const tempPaths: string[] = [];
    for (let i = 0; i < inputFiles.length; i++) {
      const file = inputFiles[i];
      const buffer = await file.blob.arrayBuffer();
      const tempPath = await window.electronAPI.storage.saveTempFile(
        `concat_${i}.${format}`,
        buffer
      );
      tempPaths.push(tempPath);
    }

    // Get output path
    const outputPath = await window.electronAPI.storage.getTempPath(outputName);

    // Run FFmpeg concatenate via IPC
    const result = await (window.electronAPI as ElectronAPIExtended).ffmpeg.concatenate(
      tempPaths,
      outputPath,
      format
    );

    if (!result.success) {
      throw new Error(result.error || 'FFmpeg concatenate failed');
    }

    // Read output file as blob
    const outputBuffer = await window.electronAPI.storage.readFile(result.path!);
    return new Blob([outputBuffer], { type: formatConfig.mimeType });
  }

  async trimVideo(
    inputBlob: Blob,
    inputName: string,
    outputName: string,
    startTime: number,
    endTime: number,
    format: 'webm' | 'mp4' = 'webm'
  ): Promise<Blob> {
    if (!FFmpegService.isSupported()) {
      throw new Error('Electron API not available');
    }

    const formatConfig = COMPOSITE_CONFIG.OUTPUT_FORMATS[format];

    // Save input blob to temp file
    const inputBuffer = await inputBlob.arrayBuffer();
    const inputPath = await window.electronAPI.storage.saveTempFile(inputName, inputBuffer);
    const outputPath = await window.electronAPI.storage.getTempPath(outputName);

    // Run FFmpeg trim via IPC
    const duration = endTime - startTime;
    const result = await (window.electronAPI as ElectronAPIExtended).ffmpeg.trim(
      inputPath,
      outputPath,
      startTime,
      duration,
      format
    );

    if (!result.success) {
      throw new Error(result.error || 'FFmpeg trim failed');
    }

    // Read output file as blob
    const outputBuffer = await window.electronAPI.storage.readFile(result.path!);
    return new Blob([outputBuffer], { type: formatConfig.mimeType });
  }

  async getVideoInfo(blob: Blob): Promise<{
    duration: number;
    width: number;
    height: number;
  }> {
    if (!FFmpegService.isSupported()) {
      throw new Error('Electron API not available');
    }

    // Save blob to temp file
    const buffer = await blob.arrayBuffer();
    const tempPath = await window.electronAPI.storage.saveTempFile('probe.webm', buffer);

    // Get video info via IPC
    const info = await (window.electronAPI as ElectronAPIExtended).ffmpeg.getVideoInfo(tempPath);
    return info;
  }

  cancel(): void {
    if (FFmpegService.isSupported()) {
      window.electronAPI.ffmpeg.cancel();
    }
  }

  terminate(): void {
    if (this.progressUnsubscribe) {
      this.progressUnsubscribe();
      this.progressUnsubscribe = null;
    }
    this.ready = false;
  }
}

// Extended API type for methods not in the base interface
interface ElectronAPIExtended {
  ffmpeg: {
    composite: (options: {
      inputFiles: string[];
      outputPath: string;
      format: 'mp4' | 'webm';
      layout: 'grid' | 'focus' | 'pip';
    }) => Promise<{ success: boolean; path?: string; error?: string }>;
    cancel: () => Promise<boolean>;
    onProgress: (callback: (progress: number) => void) => () => void;
    trim: (
      inputPath: string,
      outputPath: string,
      startTime: number,
      duration: number,
      format: 'mp4' | 'webm'
    ) => Promise<{ success: boolean; path?: string; error?: string }>;
    concatenate: (
      inputFiles: string[],
      outputPath: string,
      format: 'mp4' | 'webm'
    ) => Promise<{ success: boolean; path?: string; error?: string }>;
    getVideoInfo: (inputPath: string) => Promise<{
      duration: number;
      width: number;
      height: number;
    }>;
  };
  storage: {
    saveTempFile: (filename: string, buffer: ArrayBuffer) => Promise<string>;
    getTempPath: (filename: string) => Promise<string>;
    readFile: (filePath: string) => Promise<ArrayBuffer>;
  };
}
