import { useCallback, useEffect } from 'react';
import { useCompositeStore } from '../store/compositeStore';
import { useRecordingStore } from '../store/recordingStore';
import { useTransferStore } from '../store/transferStore';
import { compositeService, type VideoSource } from '../services/compositing';

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

  const { localBlob, editPoints, startTime, endTime } = useRecordingStore();
  const { receivedRecordings } = useTransferStore();

  // Sync composite service state with store
  useEffect(() => {
    compositeService.onStateChange((state) => {
      setStatus(state.status);
      setProgress(state.progress, state.message);
      if (state.outputBlob) {
        setOutputBlob(state.outputBlob);
      }
      if (state.error) {
        setError(state.error);
      }
    });

    return () => {
      compositeService.onStateChange(() => {});
    };
  }, [setStatus, setProgress, setOutputBlob, setError]);

  const getAvailableSources = useCallback((): VideoSource[] => {
    const sources: VideoSource[] = [];

    // Add local recording
    if (localBlob) {
      sources.push({
        id: 'local',
        name: 'My Recording',
        blob: localBlob,
        type: 'camera'
      });
    }

    // Add received recordings from peers
    for (const recording of receivedRecordings) {
      sources.push({
        id: recording.peerId,
        name: recording.peerName,
        blob: recording.blob,
        type: 'camera'
      });
    }

    return sources;
  }, [localBlob, receivedRecordings]);

  const startComposite = useCallback(
    async (selectedSourceIds?: string[]): Promise<void> => {
      if (!startTime || !endTime) {
        setError('No recording time range available');
        return;
      }

      const allSources = getAvailableSources();
      const sources = selectedSourceIds
        ? allSources.filter((s) => selectedSourceIds.includes(s.id))
        : allSources;

      if (sources.length === 0) {
        setError('No video sources available');
        return;
      }

      try {
        await compositeService.composite(sources, editPoints, startTime, endTime, {
          format: outputFormat,
          layout
        });
      } catch (err) {
        // Error already handled by service
        console.error('Composite failed:', err);
      }
    },
    [startTime, endTime, editPoints, outputFormat, layout, getAvailableSources, setError]
  );

  const startChunkedComposite = useCallback(
    async (selectedSourceIds?: string[]): Promise<void> => {
      if (!startTime || !endTime) {
        setError('No recording time range available');
        return;
      }

      const allSources = getAvailableSources();
      const sources = selectedSourceIds
        ? allSources.filter((s) => selectedSourceIds.includes(s.id))
        : allSources;

      if (sources.length === 0) {
        setError('No video sources available');
        return;
      }

      try {
        await compositeService.compositeWithChunks(sources, editPoints, startTime, endTime, {
          format: outputFormat,
          layout
        });
      } catch (err) {
        console.error('Chunked composite failed:', err);
      }
    },
    [startTime, endTime, editPoints, outputFormat, layout, getAvailableSources, setError]
  );

  const downloadOutput = useCallback(
    (filename?: string) => {
      if (!outputBlob) {
        setError('No output available to download');
        return;
      }

      const defaultFilename = `vdo-samurai-${new Date().toISOString().slice(0, 10)}.${outputFormat}`;
      const name = filename || defaultFilename;

      const url = URL.createObjectURL(outputBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    },
    [outputBlob, outputFormat, setError]
  );

  const cancelComposite = useCallback(() => {
    compositeService.terminate();
    reset();
  }, [reset]);

  const hasSourcesAvailable = useCallback(() => {
    return getAvailableSources().length > 0;
  }, [getAvailableSources]);

  const canComposite = useCallback(() => {
    return hasSourcesAvailable() && startTime !== null && endTime !== null;
  }, [hasSourcesAvailable, startTime, endTime]);

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

    // Source info
    availableSources: getAvailableSources(),
    hasSourcesAvailable: hasSourcesAvailable(),
    canComposite: canComposite(),

    // Actions
    startComposite,
    startChunkedComposite,
    downloadOutput,
    cancelComposite,
    setOutputFormat,
    setLayout,
    reset
  };
}
