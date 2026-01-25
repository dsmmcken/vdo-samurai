import { useState } from 'react';

interface ExportProgressProps {
  progress: number;
  message: string;
  status: 'loading' | 'processing' | 'error';
  error?: string | null;
  onCancel: () => void;
  onRetry?: () => void;
}

export function ExportProgress({
  progress,
  message,
  status,
  error,
  onCancel,
  onRetry,
}: ExportProgressProps) {
  const progressPercent = Math.round(progress * 100);
  const [copied, setCopied] = useState(false);

  const handleCopyError = async () => {
    if (error) {
      await navigator.clipboard.writeText(error);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // Truncate error message to ~150 chars for display
  const truncatedError =
    error && error.length > 150 ? error.slice(0, 150) + '...' : error;

  if (status === 'error') {
    return (
      <div className="bg-gray-900 rounded-xl p-6 space-y-4">
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
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </div>
          <h3 className="text-xl font-semibold text-white mb-2">Export Failed</h3>
          <p className="text-red-400 text-sm break-words">{truncatedError}</p>
          {error && error.length > 150 && (
            <button
              onClick={handleCopyError}
              className="mt-2 inline-flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-200 transition-colors"
            >
              <svg
                className="w-3.5 h-3.5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                />
              </svg>
              {copied ? 'Copied!' : 'Copy full error'}
            </button>
          )}
        </div>

        <div className="flex gap-3">
          {onRetry && (
            <button
              onClick={onRetry}
              className="flex-1 py-2 px-4 rounded-lg bg-[--color-primary] text-white hover:bg-[--color-primary]/80 transition-colors"
            >
              Try Again
            </button>
          )}
          <button
            onClick={onCancel}
            className="flex-1 py-2 px-4 rounded-lg border border-gray-700 text-gray-300 hover:bg-gray-800 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gray-900 rounded-xl p-6 space-y-6">
      <div className="text-center">
        <div className="w-20 h-20 mx-auto mb-4 relative">
          {/* Circular progress */}
          <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
            <circle
              className="text-gray-700"
              stroke="currentColor"
              strokeWidth="8"
              fill="transparent"
              r="42"
              cx="50"
              cy="50"
            />
            <circle
              className="text-[--color-primary] transition-all duration-300"
              stroke="currentColor"
              strokeWidth="8"
              strokeLinecap="round"
              fill="transparent"
              r="42"
              cx="50"
              cy="50"
              strokeDasharray={`${2 * Math.PI * 42}`}
              strokeDashoffset={`${2 * Math.PI * 42 * (1 - progress)}`}
            />
          </svg>

          {/* Percentage text */}
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-2xl font-bold text-white">{progressPercent}%</span>
          </div>
        </div>

        <h3 className="text-lg font-semibold text-white mb-1">
          {status === 'loading' ? 'Loading FFmpeg...' : 'Exporting Video'}
        </h3>
        <p className="text-gray-400 text-sm">{message}</p>
      </div>

      {/* Linear progress bar */}
      <div className="space-y-2">
        <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
          <div
            className="h-full bg-[--color-primary] transition-all duration-300"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
        <div className="flex justify-between text-xs text-gray-500">
          <span>
            {status === 'loading' && 'Initializing...'}
            {status === 'processing' && 'Encoding video...'}
          </span>
          <span>{progressPercent}% complete</span>
        </div>
      </div>

      {/* Warning */}
      <div className="flex items-start gap-3 p-3 bg-yellow-500/10 rounded-lg border border-yellow-500/20">
        <svg
          className="w-5 h-5 text-yellow-500 flex-shrink-0 mt-0.5"
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
        <div>
          <p className="text-yellow-500 text-sm font-medium">Processing locally</p>
          <p className="text-gray-400 text-xs mt-1">
            Please don't close this window until export is complete.
          </p>
        </div>
      </div>

      {/* Cancel button */}
      <button
        onClick={onCancel}
        className="w-full py-2 px-4 rounded-lg border border-gray-700 text-gray-300 hover:bg-gray-800 transition-colors"
      >
        Cancel Export
      </button>
    </div>
  );
}
