import { useState } from 'react';
import { useComposite } from '../../hooks/useComposite';

interface DownloadButtonProps {
  showPreview?: boolean;
}

export function DownloadButton({ showPreview = true }: DownloadButtonProps) {
  const { outputBlob, outputUrl, outputFormat, downloadOutput, reset } = useComposite();
  const [customFilename, setCustomFilename] = useState('');

  if (!outputBlob || !outputUrl) {
    return null;
  }

  const fileSizeMB = (outputBlob.size / (1024 * 1024)).toFixed(1);
  const defaultFilename = `vdo-samurai-${new Date().toISOString().slice(0, 10)}.${outputFormat}`;

  const handleDownload = () => {
    downloadOutput(customFilename || undefined);
  };

  return (
    <div className="space-y-4">
      {/* Video preview */}
      {showPreview && (
        <div className="aspect-video bg-black rounded-lg overflow-hidden">
          <video src={outputUrl} controls className="w-full h-full" playsInline />
        </div>
      )}

      {/* File info */}
      <div className="flex items-center justify-between text-sm">
        <span className="text-gray-400">Output Size</span>
        <span className="text-white font-medium">{fileSizeMB} MB</span>
      </div>

      {/* Filename input */}
      <div>
        <label className="block text-sm text-gray-400 mb-2">Filename (optional)</label>
        <input
          type="text"
          value={customFilename}
          onChange={(e) => setCustomFilename(e.target.value)}
          placeholder={defaultFilename}
          className="w-full px-4 py-2 bg-[--color-dark] border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-[--color-primary]"
        />
      </div>

      {/* Action buttons */}
      <div className="flex gap-3">
        <button
          onClick={handleDownload}
          className="flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-lg bg-[--color-primary] hover:bg-[--color-primary-dark] text-white font-semibold transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
            />
          </svg>
          Download
        </button>

        <button
          onClick={reset}
          className="py-3 px-4 rounded-lg border border-gray-700 text-gray-300 hover:bg-gray-800 transition-colors"
          title="Create another composite"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
        </button>
      </div>

      {/* Share hint */}
      <p className="text-xs text-gray-500 text-center">
        Your video is processed entirely in your browser. No data is uploaded to any server.
      </p>
    </div>
  );
}
