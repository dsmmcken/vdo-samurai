import { useCallback, useRef } from 'react';
import { useCompositeStore } from '../store/compositeStore';
import { FFmpegService } from '../utils/ffmpeg';
import type { VideoSource } from '../utils/TimelineBuilder';
import type { EditPoint } from '../store/recordingStore';
import type { OutputFormat } from '../utils/compositeConfig';
import type { NLEClip } from '../store/nleStore';
import type {
  ExportSegment,
  ExportSource,
  ExportPlan,
  ExportLayout,
} from '../types/export';

export type CompositeStatus = 'idle' | 'loading' | 'processing' | 'complete' | 'error';

/**
 * Build an export plan from NLE clips and video sources
 */
function buildExportPlan(
  clips: NLEClip[],
  localBlob: Blob | null,
  localScreenBlob: Blob | null,
  receivedRecordings: Array<{
    peerId: string;
    peerName: string;
    blob: Blob;
    type: 'camera' | 'screen';
  }>
): ExportPlan {
  // Log inputs for debugging
  console.log('[Export] Building export plan:');
  console.log('[Export]   localBlob:', localBlob ? `${localBlob.size} bytes` : 'null');
  console.log('[Export]   localScreenBlob:', localScreenBlob ? `${localScreenBlob.size} bytes` : 'null');
  console.log('[Export]   receivedRecordings:', receivedRecordings.map(r => ({
    peerId: r.peerId,
    peerName: r.peerName,
    type: r.type,
    size: r.blob?.size
  })));

  // Build sources array
  const sources: ExportSource[] = [];
  const sourceIndexMap = new Map<string, number>(); // peerId-type -> index

  // Add local sources
  if (localBlob) {
    const id = 'local-camera';
    sourceIndexMap.set(id, sources.length);
    sources.push({
      id,
      peerId: null,
      peerName: 'You',
      sourceType: 'camera',
      blob: localBlob,
    });
  }

  if (localScreenBlob) {
    const id = 'local-screen';
    sourceIndexMap.set(id, sources.length);
    sources.push({
      id,
      peerId: null,
      peerName: 'You',
      sourceType: 'screen',
      blob: localScreenBlob,
    });
  }

  // Add received recordings
  for (const recording of receivedRecordings) {
    const id = `${recording.peerId}-${recording.type}`;
    sourceIndexMap.set(id, sources.length);
    sources.push({
      id,
      peerId: recording.peerId,
      peerName: recording.peerName,
      sourceType: recording.type,
      blob: recording.blob,
    });
  }

  // Sort clips by order
  const sortedClips = [...clips].sort((a, b) => a.order - b.order);

  // Log available sources for debugging
  console.log('[Export] Available sources:', Array.from(sourceIndexMap.entries()));
  console.log('[Export] Clips to process:', sortedClips.map(c => ({
    id: c.id,
    peerId: c.peerId,
    peerName: c.peerName,
    sourceType: c.sourceType,
  })));

  // Build segments from clips
  const segments: ExportSegment[] = [];
  let currentOutputTime = 0;

  for (const clip of sortedClips) {
    if (clip.sourceType === 'audio-only') continue;

    const clipDurationMs = clip.endTime - clip.startTime - clip.trimStart - clip.trimEnd;
    if (clipDurationMs <= 0) continue;

    // Determine peer key prefix
    const peerKeyPrefix = clip.peerId ?? 'local';

    // Find camera and screen sources for this peer
    const cameraKey = `${peerKeyPrefix}-camera`;
    const screenKey = `${peerKeyPrefix}-screen`;
    const cameraIndex = sourceIndexMap.get(cameraKey);
    const screenIndex = sourceIndexMap.get(screenKey);

    console.log(`[Export] Clip ${clip.id} (${clip.peerName}): cameraKey=${cameraKey} (${cameraIndex}), screenKey=${screenKey} (${screenIndex})`);

    // Determine layout based on available sources
    let layout: ExportLayout;
    if (screenIndex !== undefined && cameraIndex !== undefined) {
      layout = 'screen-pip';
    } else if (screenIndex !== undefined) {
      layout = 'screen-only';
    } else if (cameraIndex !== undefined) {
      layout = 'camera-only';
    } else {
      // No sources available - skip this segment
      console.warn(`[Export] No sources found for clip ${clip.id} (peer: ${peerKeyPrefix})`);
      continue;
    }

    console.log(`[Export] Clip ${clip.id} layout: ${layout}`);

    const segment: ExportSegment = {
      id: clip.id,
      startTimeMs: currentOutputTime,
      endTimeMs: currentOutputTime + clipDurationMs,
      peerId: clip.peerId,
      peerName: clip.peerName,
      layout,
    };

    // Add source references
    if (cameraIndex !== undefined) {
      segment.camera = {
        sourceIndex: cameraIndex,
        trimStartMs: clip.trimStart,
        trimEndMs: clip.trimEnd,
      };
    }

    if (screenIndex !== undefined) {
      segment.screen = {
        sourceIndex: screenIndex,
        trimStartMs: clip.trimStart,
        trimEndMs: clip.trimEnd,
      };
    }

    segments.push(segment);
    currentOutputTime += clipDurationMs;
  }

  return {
    segments,
    sources,
    totalDurationMs: currentOutputTime,
  };
}

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
        setProgress(0.1, `Processing ${sources.length} video(s)...`);

        // Prepare input files
        const inputFiles = sources.map((source, index) => ({
          name: `input${index}.webm`,
          blob: source.blob
        }));

        const outputName = `output.${format}`;

        // Run composite with layout support
        const result = await ffmpeg.compositeWithLayout(
          inputFiles,
          outputName,
          format,
          layoutOption
        );

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
    // Also cancel timeline export if running
    if (typeof window !== 'undefined' && window.electronAPI) {
      window.electronAPI.ffmpeg.cancelTimeline();
    }
    reset();
  }, [reset]);

  const terminate = useCallback(() => {
    const ffmpeg = ffmpegRef.current;
    ffmpeg?.terminate();
    ffmpegRef.current = null;
    reset();
  }, [reset]);

  /**
   * Timeline-aware export that switches between active users based on NLE clips
   */
  const compositeTimeline = useCallback(
    async (
      clips: NLEClip[],
      localBlob: Blob | null,
      localScreenBlob: Blob | null,
      receivedRecordings: Array<{
        peerId: string;
        peerName: string;
        blob: Blob;
        type: 'camera' | 'screen';
      }>,
      options: {
        format?: OutputFormat;
        transitionDurationMs?: number;
      } = {}
    ): Promise<Blob> => {
      const { format = 'webm', transitionDurationMs = 300 } = options;

      if (!window.electronAPI) {
        throw new Error('Timeline export requires Electron');
      }

      setStatus('processing');
      setProgress(0, 'Building export plan...');
      setOutputBlob(null);
      setError(null);

      try {
        // Build export plan from clips
        const plan = buildExportPlan(clips, localBlob, localScreenBlob, receivedRecordings);

        if (plan.segments.length === 0) {
          throw new Error('No valid segments to export');
        }

        if (plan.sources.length === 0) {
          throw new Error('No video sources available');
        }

        setProgress(0.05, 'Saving video files...');

        // Save all source blobs to temp files
        const tempPaths: string[] = [];
        for (let i = 0; i < plan.sources.length; i++) {
          const source = plan.sources[i];
          const buffer = await source.blob.arrayBuffer();
          const tempPath = await window.electronAPI.storage.saveTempFile(
            `timeline-source-${i}.webm`,
            buffer
          );
          tempPaths.push(tempPath);
        }

        // Get output path
        const outputPath = await window.electronAPI.storage.getTempPath(`timeline-output.${format}`);

        setProgress(0.1, 'Processing timeline...');

        // Set up progress listener
        const unsubscribe = window.electronAPI.ffmpeg.onProgress((prog) => {
          setProgress(prog, `Encoding: ${Math.round(prog * 100)}%`);
        });

        try {
          // Call timeline export
          const result = await window.electronAPI.ffmpeg.compositeTimeline({
            inputFiles: tempPaths,
            outputPath,
            format,
            segments: plan.segments,
            sourceCount: plan.sources.length,
            transitionDurationMs,
          });

          if (!result.success) {
            throw new Error(result.error || 'Timeline export failed');
          }

          // Read result blob
          const outputBuffer = await window.electronAPI.storage.readFile(result.path!);
          const mimeType = format === 'mp4' ? 'video/mp4' : 'video/webm';
          const outputBlob = new Blob([outputBuffer], { type: mimeType });

          setStatus('complete');
          setProgress(1, 'Export complete!');
          setOutputBlob(outputBlob);

          return outputBlob;
        } finally {
          unsubscribe();
        }
      } catch (err) {
        const errMessage = err instanceof Error ? err.message : 'Timeline export failed';
        setStatus('error');
        setError(errMessage);
        setProgress(0, 'Export failed');
        throw err;
      }
    },
    [setStatus, setProgress, setOutputBlob, setError]
  );

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
    compositeTimeline,
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
