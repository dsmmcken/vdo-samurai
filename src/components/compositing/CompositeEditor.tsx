import { useState } from 'react';
import { useComposite } from '../../hooks/useComposite';
import { CompositeProgress } from './CompositeProgress';
import { DownloadButton } from './DownloadButton';
import { FFmpegService } from '../../services/compositing/FFmpegService';

export function CompositeEditor() {
  const {
    status,
    availableSources,
    canComposite,
    outputFormat,
    layout,
    setOutputFormat,
    setLayout,
    startComposite
  } = useComposite();

  const [selectedSources, setSelectedSources] = useState<string[]>([]);

  const toggleSource = (sourceId: string) => {
    setSelectedSources((prev) =>
      prev.includes(sourceId) ? prev.filter((id) => id !== sourceId) : [...prev, sourceId]
    );
  };

  const selectAll = () => {
    setSelectedSources(availableSources.map((s) => s.id));
  };

  const selectNone = () => {
    setSelectedSources([]);
  };

  const handleStartComposite = () => {
    const sourcesToUse = selectedSources.length > 0 ? selectedSources : undefined;
    startComposite(sourcesToUse);
  };

  const isProcessing = status === 'loading' || status === 'processing';
  const isElectronAvailable = FFmpegService.isSupported();

  if (status === 'processing' || status === 'loading') {
    return <CompositeProgress />;
  }

  if (status === 'complete') {
    return (
      <div className="bg-[--color-dark-lighter] rounded-xl p-6 space-y-6">
        <div className="text-center">
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
          <h3 className="text-xl font-semibold text-white mb-2">Composite Complete!</h3>
          <p className="text-gray-400">Your video is ready to download.</p>
        </div>

        <DownloadButton />
      </div>
    );
  }

  // Show error if Electron API is not available
  if (!isElectronAvailable) {
    return (
      <div className="bg-[--color-dark-lighter] rounded-xl p-6 space-y-4">
        <div className="text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-red-500/20 flex items-center justify-center">
            <svg
              className="w-8 h-8 text-red-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          </div>
          <h3 className="text-xl font-semibold text-white mb-2">Desktop App Required</h3>
          <p className="text-gray-400 text-sm">
            Video compositing requires the VDO Samurai desktop application.
          </p>
          <p className="text-gray-500 text-xs mt-2">
            Please run this application in Electron to enable video processing.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-[--color-dark-lighter] rounded-xl p-6 space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-white mb-2">Video Composite</h3>
        <p className="text-gray-400 text-sm">
          Combine recordings from all participants into a single video.
        </p>
      </div>

      {/* Source selection */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <label className="text-sm font-medium text-gray-300">Video Sources</label>
          <div className="flex gap-2">
            <button onClick={selectAll} className="text-xs text-[--color-primary] hover:underline">
              Select all
            </button>
            <span className="text-gray-600">|</span>
            <button onClick={selectNone} className="text-xs text-[--color-primary] hover:underline">
              Clear
            </button>
          </div>
        </div>

        {availableSources.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <svg
              className="w-12 h-12 mx-auto mb-3 text-gray-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
              />
            </svg>
            <p>No recordings available yet.</p>
            <p className="text-sm mt-1">Complete a recording session first.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {availableSources.map((source) => (
              <label
                key={source.id}
                className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                  selectedSources.includes(source.id) || selectedSources.length === 0
                    ? 'border-[--color-primary] bg-[--color-primary]/10'
                    : 'border-gray-700 hover:border-gray-600'
                }`}
              >
                <input
                  type="checkbox"
                  checked={selectedSources.includes(source.id) || selectedSources.length === 0}
                  onChange={() => toggleSource(source.id)}
                  className="w-4 h-4 rounded border-gray-600 text-[--color-primary] focus:ring-[--color-primary]"
                />
                <div className="flex-1">
                  <div className="text-white font-medium">{source.name}</div>
                  <div className="text-xs text-gray-500">
                    {source.type === 'screen' ? 'Screen Share' : 'Camera'} •{' '}
                    {(source.blob.size / (1024 * 1024)).toFixed(1)} MB
                  </div>
                </div>
              </label>
            ))}
          </div>
        )}
      </div>

      {/* Layout selection */}
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-3">Layout</label>
        <div className="grid grid-cols-3 gap-3">
          <button
            onClick={() => setLayout('grid')}
            className={`p-4 rounded-lg border transition-colors ${
              layout === 'grid'
                ? 'border-[--color-primary] bg-[--color-primary]/10'
                : 'border-gray-700 hover:border-gray-600'
            }`}
          >
            <div className="grid grid-cols-2 gap-1 w-12 h-8 mx-auto mb-2">
              <div className="bg-gray-500 rounded-sm"></div>
              <div className="bg-gray-500 rounded-sm"></div>
              <div className="bg-gray-500 rounded-sm"></div>
              <div className="bg-gray-500 rounded-sm"></div>
            </div>
            <span className="text-sm text-gray-300">Grid</span>
          </button>

          <button
            onClick={() => setLayout('focus')}
            className={`p-4 rounded-lg border transition-colors ${
              layout === 'focus'
                ? 'border-[--color-primary] bg-[--color-primary]/10'
                : 'border-gray-700 hover:border-gray-600'
            }`}
          >
            <div className="flex gap-1 w-12 h-8 mx-auto mb-2">
              <div className="bg-gray-500 rounded-sm flex-1"></div>
              <div className="flex flex-col gap-0.5 w-3">
                <div className="bg-gray-500 rounded-sm flex-1"></div>
                <div className="bg-gray-500 rounded-sm flex-1"></div>
              </div>
            </div>
            <span className="text-sm text-gray-300">Focus</span>
          </button>

          <button
            onClick={() => setLayout('pip')}
            className={`p-4 rounded-lg border transition-colors ${
              layout === 'pip'
                ? 'border-[--color-primary] bg-[--color-primary]/10'
                : 'border-gray-700 hover:border-gray-600'
            }`}
          >
            <div className="relative w-12 h-8 mx-auto mb-2">
              <div className="bg-gray-500 rounded-sm w-full h-full"></div>
              <div className="absolute bottom-0.5 right-0.5 w-4 h-3 bg-gray-400 rounded-sm"></div>
            </div>
            <span className="text-sm text-gray-300">PiP</span>
          </button>
        </div>
      </div>

      {/* Format selection */}
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-3">Output Format</label>
        <div className="flex gap-3">
          <button
            onClick={() => setOutputFormat('webm')}
            className={`flex-1 py-2 px-4 rounded-lg border transition-colors ${
              outputFormat === 'webm'
                ? 'border-[--color-primary] bg-[--color-primary]/10 text-white'
                : 'border-gray-700 text-gray-400 hover:border-gray-600'
            }`}
          >
            WebM (VP9)
          </button>
          <button
            onClick={() => setOutputFormat('mp4')}
            className={`flex-1 py-2 px-4 rounded-lg border transition-colors ${
              outputFormat === 'mp4'
                ? 'border-[--color-primary] bg-[--color-primary]/10 text-white'
                : 'border-gray-700 text-gray-400 hover:border-gray-600'
            }`}
          >
            MP4 (H.264)
          </button>
        </div>
      </div>

      {/* Start button */}
      <button
        onClick={handleStartComposite}
        disabled={!canComposite || isProcessing}
        className={`w-full py-3 px-4 rounded-lg font-semibold transition-colors ${
          canComposite && !isProcessing
            ? 'bg-[--color-primary] hover:bg-[--color-primary-dark] text-white'
            : 'bg-gray-700 text-gray-500 cursor-not-allowed'
        }`}
      >
        {isProcessing ? 'Processing...' : 'Start Composite'}
      </button>

      {!canComposite && availableSources.length > 0 && (
        <p className="text-sm text-yellow-500 text-center">
          Recording time range not available. Complete a recording session first.
        </p>
      )}
    </div>
  );
}
