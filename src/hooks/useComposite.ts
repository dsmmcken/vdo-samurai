import { useCallback, useRef } from 'react';
import { useCompositeStore } from '../store/compositeStore';
import { FFmpegService } from '../utils/ffmpeg';
import { TimelineBuilder, type VideoSource } from '../utils/TimelineBuilder';
import type { EditPoint } from '../store/recordingStore';
import type { OutputFormat } from '../utils/compositeConfig';

export type CompositeStatus = 'idle' | 'loading' | 'processing' | 'complete' | 'error';

export function useComposite() {
  const {
    status,
    progress,
    message,
    outputBlob,
    outputUrl,
    error,
    outputFormat,
    layout,
    setStatus,
    setProgress,
    setOutputBlob,
    setError,
    setOutputFormat,
    setLayout,
    reset
  } = useCompositeStore();

  const ffmpegRef = useRef<FFmpegService | null>(null);

  // Lazy initialization of FFmpeg service
  const getFFmpeg = useCallback(() => {
    if (!ffmpegRef.current) {
      ffmpegRef.current = new FFmpegService();
    }
    return ffmpegRef.current;
  }, []);

  const initialize = useCallback(async () => {
    const ffmpeg = getFFmpeg();
    if (ffmpeg.isLoaded()) {
      return;
    }

    setStatus('loading');
    setProgress(0, 'Initializing FFmpeg...');
    setError(null);

    try {
      await ffmpeg.load();
      setStatus('idle');
      setProgress(0, 'FFmpeg ready');
    } catch (err) {
      const errMessage = err instanceof Error ? err.message : 'Failed to initialize FFmpeg';
      setStatus('error');
      setError(errMessage);
      setProgress(0, 'FFmpeg initialization failed');
      throw err;
    }
  }, [getFFmpeg, setStatus, setProgress, setError]);

  const composite = useCallback(
    async (
      sources: VideoSource[],
      editPoints: EditPoint[],
      recordingStartTime: number,
      recordingEndTime: number,
      options: {
        format?: OutputFormat;
        layout?: 'focus' | 'grid' | 'pip';
      } = {}
    ): Promise<Blob> => {
      const { format = 'webm', layout: layoutOption = 'grid' } = options;
      const ffmpeg = getFFmpeg();

      // Initialize FFmpeg if needed
      await initialize();

      setStatus('processing');
      setProgress(0, 'Preparing videos...');
      setOutputBlob(null);
      setError(null);

      // Set up progress tracking
      ffmpeg.onProgress((prog, msg) => {
        setProgress(Math.min(0.1 + prog * 0.8, 0.9), msg);
      });

      try {
        // Build timeline (used for future layout-aware compositing)
        new TimelineBuilder()
          .setSources(sources)
          .setEditPoints(editPoints)
          .setRecordingTimeRange(recordingStartTime, recordingEndTime)
          .buildJob(format, layoutOption);

        setProgress(0.1, `Processing ${sources.length} video(s)...`);

        // Prepare input files
        const inputFiles = sources.map((source, index) => ({
          name: `input${index}.webm`,
          blob: source.blob
        }));

        const outputName = `output.${format}`;

        // Run composite with layout support
        const result = await ffmpeg.compositeWithLayout(inputFiles, outputName, format, layoutOption);

        setStatus('complete');
        setProgress(1, 'Composite complete!');
        setOutputBlob(result);

        return result;
      } catch (err) {
        const errMessage = err instanceof Error ? err.message : 'Composite failed';
        setStatus('error');
        setError(errMessage);
        setProgress(0, 'Processing failed');
        throw err;
      }
    },
    [getFFmpeg, initialize, setStatus, setProgress, setOutputBlob, setError]
  );

  const download = useCallback(
    async (filename: string = 'composite'): Promise<void> => {
      if (!outputBlob) {
        throw new Error('No output to download');
      }

      // Use native save dialog if available (Electron)
      if (typeof window !== 'undefined' && window.electronAPI) {
        const extension = outputBlob.type.includes('mp4') ? 'mp4' : 'webm';
        const defaultName = `${filename}.${extension}`;

        const result = await window.electronAPI.storage.showSaveDialog(defaultName);
        if (result.canceled || !result.filePath) {
          return;
        }

        const buffer = await outputBlob.arrayBuffer();
        await window.electronAPI.storage.saveFile(result.filePath, buffer);
      } else {
        // Fallback to browser download
        const url = URL.createObjectURL(outputBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
    },
    [outputBlob]
  );

  const cancel = useCallback(() => {
    const ffmpeg = ffmpegRef.current;
    ffmpeg?.cancel();
    reset();
  }, [reset]);

  const terminate = useCallback(() => {
    const ffmpeg = ffmpegRef.current;
    ffmpeg?.terminate();
    ffmpegRef.current = null;
    reset();
  }, [reset]);

  return {
    // State
    status,
    progress,
    message,
    outputBlob,
    outputUrl,
    error,
    outputFormat,
    layout,

    // Settings
    setOutputFormat,
    setLayout,

    // Actions
    composite,
    download,
    cancel,
    terminate,
    reset,

    // Static helper
    isSupported: FFmpegService.isSupported
  };
}

// Re-export VideoSource type for convenience
export type { VideoSource } from '../utils/TimelineBuilder';
