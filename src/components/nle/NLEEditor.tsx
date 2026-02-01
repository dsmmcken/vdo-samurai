import { useCallback, useEffect } from 'react';
import { useNLEStore, getClipDuration } from '../../store/nleStore';
import { useTransferStore } from '../../store/transferStore';
import { useRecordingStore } from '../../store/recordingStore';
import { useComposite } from '../../hooks/useComposite';
import { FFmpegService } from '../../utils/ffmpeg';
import { Timeline } from './Timeline';
import { PreviewPanel } from './PreviewPanel';
import { TransferQueue } from './TransferQueue';
import { ExportProgress } from './ExportProgress';
import { DownloadButton } from './DownloadButton';

interface NLEEditorProps {
  onClose: () => void;
}

export function NLEEditor({ onClose }: NLEEditorProps) {
  const {
    clips,
    selectedClipId,
    deleteClip,
    splitClip,
    playheadPosition,
    setPlayheadPosition,
    isPlaying,
    setIsPlaying,
    totalDuration
  } = useNLEStore();
  const { transfers, receivedRecordings } = useTransferStore();
  const { localBlob, localScreenBlob } = useRecordingStore();

  // Use the composite hook instead of direct service
  const {
    status: exportStatus,
    progress: exportProgress,
    message: exportMessage,
    error: exportError,
    outputBlob,
    outputUrl,
    outputFormat,
    compositeTimeline,
    reset: resetExport,
    terminate: terminateComposite
  } = useComposite();

  // Check if any transfers are still in progress
  const hasActiveTransfers = transfers.some(
    (t) => t.direction === 'receive' && (t.status === 'pending' || t.status === 'active')
  );

  // Check if FFmpeg is available
  const isFFmpegAvailable = FFmpegService.isSupported();

  const handleSplitClip = useCallback(() => {
    if (!selectedClipId) return;

    // Calculate split time relative to the selected clip
    const sortedClips = [...clips].sort((a, b) => a.order - b.order);
    let accumulated = 0;

    for (const clip of sortedClips) {
      const duration = getClipDuration(clip);
      if (clip.id === selectedClipId) {
        const splitTime = playheadPosition - accumulated;
        if (splitTime > 0 && splitTime < duration) {
          splitClip(selectedClipId, splitTime);
        }
        break;
      }
      accumulated += duration;
    }
  }, [selectedClipId, clips, playheadPosition, splitClip]);

  const togglePlayback = useCallback(() => {
    if (isPlaying) {
      setIsPlaying(false);
    } else {
      // If at end, restart from beginning
      if (playheadPosition >= totalDuration - 100) {
        setPlayheadPosition(0);
      }
      setIsPlaying(true);
    }
  }, [isPlaying, playheadPosition, totalDuration, setIsPlaying, setPlayheadPosition]);

  const skipBackward = useCallback(() => {
    setPlayheadPosition(Math.max(0, playheadPosition - 5000));
  }, [playheadPosition, setPlayheadPosition]);

  const skipForward = useCallback(() => {
    setPlayheadPosition(Math.min(totalDuration, playheadPosition + 5000));
  }, [playheadPosition, totalDuration, setPlayheadPosition]);

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      switch (e.key) {
        case ' ':
          e.preventDefault();
          togglePlayback();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          skipBackward();
          break;
        case 'ArrowRight':
          e.preventDefault();
          skipForward();
          break;
        case 's':
        case 'S':
          // Split clip at playhead
          if (selectedClipId) {
            e.preventDefault();
            handleSplitClip();
          }
          break;
        case 'Delete':
        case 'Backspace':
          // Delete selected clip
          if (selectedClipId) {
            e.preventDefault();
            deleteClip(selectedClipId);
          }
          break;
        case 'Escape':
          // Close editor
          onClose();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    selectedClipId,
    deleteClip,
    onClose,
    handleSplitClip,
    togglePlayback,
    skipBackward,
    skipForward
  ]);

  const handleExport = useCallback(async () => {
    // Need at least local recording or clips to export
    if (!localBlob && clips.length === 0) {
      return;
    }

    try {
      // Use timeline-aware export
      await compositeTimeline(clips, localBlob, localScreenBlob, receivedRecordings, {
        format: outputFormat,
        transitionDurationMs: 300 // 0.3s crossfade
      });
    } catch (err) {
      console.error('Export failed:', err);
    }
  }, [clips, localBlob, localScreenBlob, receivedRecordings, outputFormat, compositeTimeline]);

  const handleCancelExport = useCallback(() => {
    terminateComposite();
  }, [terminateComposite]);

  const handlePlayheadDragStart = useCallback(() => {
    setIsPlaying(false);
  }, [setIsPlaying]);

  const handlePlayheadDragEnd = useCallback(() => {
    // Playhead drag ended - could resume playback here if desired
  }, []);

  // Show export progress overlay
  if (exportStatus === 'loading' || exportStatus === 'processing' || exportStatus === 'error') {
    return (
      <div className="h-full flex flex-col bg-gray-950">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
          <h2 className="text-lg font-semibold text-white">Exporting Video</h2>
        </div>

        {/* Export progress */}
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="max-w-md w-full">
            <ExportProgress
              progress={exportProgress}
              message={exportMessage}
              status={exportStatus}
              error={exportError}
              onCancel={handleCancelExport}
              onRetry={exportStatus === 'error' ? handleExport : undefined}
            />
          </div>
        </div>
      </div>
    );
  }

  // Show download screen after export
  if (exportStatus === 'complete' && outputBlob && outputUrl) {
    return (
      <div className="h-full flex flex-col bg-gray-950">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
          <h2 className="text-lg font-semibold text-white">Export Complete</h2>
          <button
            onClick={() => {
              resetExport();
            }}
            className="text-gray-400 hover:text-white transition-colors"
          >
            Back to Editor
          </button>
        </div>

        {/* Download content */}
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="max-w-lg w-full">
            <div className="bg-gray-900 rounded-xl p-6">
              <div className="text-center mb-6">
                <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-green-500/20 flex items-center justify-center">
                  <svg
                    className="w-8 h-8 text-green-500"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                </div>
                <h3 className="text-xl font-semibold text-white">Video Ready!</h3>
                <p className="text-gray-400 text-sm mt-1">
                  Your video has been exported successfully.
                </p>
              </div>
              <DownloadButton
                outputBlob={outputBlob}
                outputUrl={outputUrl}
                outputFormat={outputFormat}
                onReset={resetExport}
              />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-gray-950 relative">
      {/* Transfer queue indicator */}
      <TransferQueue />

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
        <div className="flex items-center gap-4">
          <h2 className="text-lg font-semibold text-white">Video Editor</h2>
          {hasActiveTransfers && (
            <span className="text-xs text-amber-400 flex items-center gap-1">
              <span className="w-2 h-2 bg-amber-400 rounded-full animate-pulse" />
              Transfers in progress
            </span>
          )}
        </div>

        <div className="flex items-center gap-3">
          {/* Export button */}
          <button
            onClick={handleExport}
            disabled={hasActiveTransfers || !isFFmpegAvailable || clips.length === 0}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${
              hasActiveTransfers || !isFFmpegAvailable || clips.length === 0
                ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                : 'bg-[--color-primary] hover:bg-[--color-primary]/80 text-white'
            }`}
            title={
              hasActiveTransfers
                ? 'Wait for transfers to complete'
                : !isFFmpegAvailable
                  ? 'FFmpeg not available'
                  : 'Export video'
            }
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
              />
            </svg>
            Export
          </button>

          {/* Close button */}
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-white transition-colors rounded-lg hover:bg-gray-800"
            title="Close editor (Esc)"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-h-0 p-4 gap-4">
        {/* Preview panel */}
        <div className="flex-1 min-h-0">
          <PreviewPanel />
        </div>

        {/* Toolbar */}
        <div className="flex-shrink-0 relative flex items-center justify-between px-2">
          <div className="flex items-center gap-2">
            <button
              onClick={handleSplitClip}
              disabled={!selectedClipId}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-sm transition-colors ${
                selectedClipId
                  ? 'text-gray-300 hover:text-white hover:bg-gray-800'
                  : 'text-gray-600 cursor-not-allowed'
              }`}
              title="Split clip at playhead (S)"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M8 7h8M8 12h8m-8 5h8"
                />
              </svg>
              Split
            </button>

            <button
              onClick={() => selectedClipId && deleteClip(selectedClipId)}
              disabled={!selectedClipId}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-sm transition-colors ${
                selectedClipId
                  ? 'text-gray-300 hover:text-red-400 hover:bg-gray-800'
                  : 'text-gray-600 cursor-not-allowed'
              }`}
              title="Delete selected clip (Delete)"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                />
              </svg>
              Delete
            </button>
          </div>

          {/* Playback controls - absolutely centered */}
          <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-1">
            <button
              onClick={skipBackward}
              className="p-1.5 text-gray-400 hover:text-white transition-colors rounded hover:bg-gray-800"
              title="Skip backward 5s (←)"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12.066 11.2a1 1 0 000 1.6l5.334 4A1 1 0 0019 16V8a1 1 0 00-1.6-.8l-5.333 4zM4.066 11.2a1 1 0 000 1.6l5.334 4A1 1 0 0011 16V8a1 1 0 00-1.6-.8l-5.334 4z"
                />
              </svg>
            </button>

            <button
              onClick={togglePlayback}
              className="p-1.5 text-gray-400 hover:text-white transition-colors rounded hover:bg-gray-800"
              title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
            >
              {isPlaying ? (
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
                </svg>
              ) : (
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
              )}
            </button>

            <button
              onClick={skipForward}
              className="p-1.5 text-gray-400 hover:text-white transition-colors rounded hover:bg-gray-800"
              title="Skip forward 5s (→)"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M11.933 12.8a1 1 0 000-1.6L6.6 7.2A1 1 0 005 8v8a1 1 0 001.6.8l5.333-4zM19.933 12.8a1 1 0 000-1.6l-5.333-4A1 1 0 0013 8v8a1 1 0 001.6.8l5.333-4z"
                />
              </svg>
            </button>
          </div>

          <span className="text-xs text-gray-500">
            {clips.length} clip{clips.length !== 1 ? 's' : ''}
            {selectedClipId && ' • 1 selected'}
          </span>
        </div>

        {/* Timeline */}
        <div className="flex-shrink-0">
          <Timeline
            onPlayheadDragStart={handlePlayheadDragStart}
            onPlayheadDragEnd={handlePlayheadDragEnd}
          />
        </div>
      </div>

      {/* Keyboard shortcuts hint */}
      <div className="flex items-center justify-center gap-4 px-4 py-2 border-t border-gray-800 text-[10px] text-gray-600">
        <span>
          <kbd className="px-1 py-0.5 bg-gray-800 rounded">Space</kbd> Play/Pause
        </span>
        <span>
          <kbd className="px-1 py-0.5 bg-gray-800 rounded">S</kbd> Split
        </span>
        <span>
          <kbd className="px-1 py-0.5 bg-gray-800 rounded">Del</kbd> Delete
        </span>
        <span>
          <kbd className="px-1 py-0.5 bg-gray-800 rounded">Esc</kbd> Close
        </span>
      </div>
    </div>
  );
}
