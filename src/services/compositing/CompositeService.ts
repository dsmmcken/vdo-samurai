import { ffmpegService } from './FFmpegService';
import { TimelineBuilder, type VideoSource } from './TimelineBuilder';
import type { EditPoint } from '../../store/recordingStore';
import type { OutputFormat } from './config';

export type CompositeStatus = 'idle' | 'loading' | 'processing' | 'complete' | 'error';

export interface CompositeState {
  status: CompositeStatus;
  progress: number;
  message: string;
  outputBlob: Blob | null;
  error: string | null;
}

type StateCallback = (state: CompositeState) => void;

export class CompositeService {
  private state: CompositeState = {
    status: 'idle',
    progress: 0,
    message: '',
    outputBlob: null,
    error: null
  };

  private stateCallback: StateCallback | null = null;

  onStateChange(callback: StateCallback): void {
    this.stateCallback = callback;
  }

  private updateState(updates: Partial<CompositeState>): void {
    this.state = { ...this.state, ...updates };
    this.stateCallback?.(this.state);
  }

  getState(): CompositeState {
    return { ...this.state };
  }

  async initialize(): Promise<void> {
    if (ffmpegService.isLoaded()) {
      return;
    }

    this.updateState({
      status: 'loading',
      progress: 0,
      message: 'Initializing FFmpeg...',
      error: null
    });

    try {
      await ffmpegService.load();
      this.updateState({
        status: 'idle',
        progress: 0,
        message: 'FFmpeg ready'
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to initialize FFmpeg';
      this.updateState({
        status: 'error',
        error: message,
        message: 'FFmpeg initialization failed'
      });
      throw error;
    }
  }

  async composite(
    sources: VideoSource[],
    editPoints: EditPoint[],
    recordingStartTime: number,
    recordingEndTime: number,
    options: {
      format?: OutputFormat;
      layout?: 'focus' | 'grid' | 'pip';
    } = {}
  ): Promise<Blob> {
    const { format = 'webm', layout = 'grid' } = options;

    // Initialize FFmpeg if needed
    await this.initialize();

    this.updateState({
      status: 'processing',
      progress: 0,
      message: 'Preparing videos...',
      outputBlob: null,
      error: null
    });

    // Set up progress tracking
    ffmpegService.onProgress((progress, message) => {
      this.updateState({
        progress: Math.min(0.1 + progress * 0.8, 0.9), // Reserve 10% for prep, 10% for cleanup
        message
      });
    });

    try {
      // Build timeline (used for future layout-aware compositing)
      new TimelineBuilder()
        .setSources(sources)
        .setEditPoints(editPoints)
        .setRecordingTimeRange(recordingStartTime, recordingEndTime)
        .buildJob(format, layout);

      this.updateState({
        progress: 0.1,
        message: `Processing ${sources.length} video(s)...`
      });

      // Prepare input files
      const inputFiles = sources.map((source, index) => ({
        name: `input${index}.webm`,
        blob: source.blob
      }));

      const outputName = `output.${format}`;

      // Run composite with layout support
      const outputBlob = await ffmpegService.compositeWithLayout(
        inputFiles,
        outputName,
        format,
        layout
      );

      this.updateState({
        status: 'complete',
        progress: 1,
        message: 'Composite complete!',
        outputBlob
      });

      return outputBlob;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Composite failed';
      this.updateState({
        status: 'error',
        error: message,
        message: 'Processing failed'
      });
      throw error;
    }
  }

  async compositeWithChunks(
    sources: VideoSource[],
    editPoints: EditPoint[],
    recordingStartTime: number,
    recordingEndTime: number,
    options: {
      format?: OutputFormat;
      layout?: 'focus' | 'grid' | 'pip';
    } = {}
  ): Promise<Blob> {
    const { format = 'webm', layout = 'grid' } = options;

    // Initialize FFmpeg if needed
    await this.initialize();

    this.updateState({
      status: 'processing',
      progress: 0,
      message: 'Preparing chunked processing...',
      outputBlob: null,
      error: null
    });

    try {
      const builder = new TimelineBuilder()
        .setSources(sources)
        .setEditPoints(editPoints)
        .setRecordingTimeRange(recordingStartTime, recordingEndTime);

      const chunks = builder.chunkSegments();
      const totalChunks = chunks.length;

      if (totalChunks <= 1) {
        // No need for chunking, use simple composite
        return this.composite(sources, editPoints, recordingStartTime, recordingEndTime, options);
      }

      const processedChunks: { name: string; blob: Blob }[] = [];

      // Process each chunk
      for (let i = 0; i < totalChunks; i++) {
        this.updateState({
          progress: (i / totalChunks) * 0.8,
          message: `Processing chunk ${i + 1} of ${totalChunks}...`
        });

        const chunkSegments = chunks[i];
        const chunkStart = chunkSegments[0].startTime;
        const chunkEnd = chunkSegments[chunkSegments.length - 1].endTime;

        // Trim each source to this chunk's time range
        const chunkSources: { name: string; blob: Blob }[] = [];

        for (let j = 0; j < sources.length; j++) {
          const source = sources[j];
          const trimmedBlob = await ffmpegService.trimVideo(
            source.blob,
            `source${j}.webm`,
            `trimmed${j}_${i}.webm`,
            chunkStart,
            chunkEnd,
            format
          );

          chunkSources.push({
            name: `chunk${i}_source${j}.webm`,
            blob: trimmedBlob
          });
        }

        // Composite this chunk with layout
        const chunkOutput = await ffmpegService.compositeWithLayout(
          chunkSources,
          `chunk${i}_output.${format}`,
          format,
          layout
        );

        processedChunks.push({
          name: `chunk${i}.${format}`,
          blob: chunkOutput
        });
      }

      this.updateState({
        progress: 0.85,
        message: 'Concatenating chunks...'
      });

      // Concatenate all chunks
      const finalOutput = await ffmpegService.concatenateVideos(
        processedChunks,
        `final.${format}`,
        format
      );

      this.updateState({
        status: 'complete',
        progress: 1,
        message: 'Composite complete!',
        outputBlob: finalOutput
      });

      return finalOutput;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Chunked composite failed';
      this.updateState({
        status: 'error',
        error: message,
        message: 'Processing failed'
      });
      throw error;
    }
  }

  async downloadOutput(filename: string = 'composite'): Promise<void> {
    if (!this.state.outputBlob) {
      throw new Error('No output to download');
    }

    // Use native save dialog if available (Electron)
    if (typeof window !== 'undefined' && window.electronAPI) {
      const extension = this.state.outputBlob.type.includes('mp4') ? 'mp4' : 'webm';
      const defaultName = `${filename}.${extension}`;

      const result = await window.electronAPI.storage.showSaveDialog(defaultName);
      if (result.canceled || !result.filePath) {
        return;
      }

      const buffer = await this.state.outputBlob.arrayBuffer();
      await window.electronAPI.storage.saveFile(result.filePath, buffer);
    } else {
      // Fallback to browser download
      const url = URL.createObjectURL(this.state.outputBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  }

  reset(): void {
    this.updateState({
      status: 'idle',
      progress: 0,
      message: '',
      outputBlob: null,
      error: null
    });
  }

  terminate(): void {
    ffmpegService.terminate();
    this.reset();
  }
}

// Singleton instance
export const compositeService = new CompositeService();
