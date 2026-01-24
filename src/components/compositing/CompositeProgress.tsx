import { useComposite } from '../../hooks/useComposite';

export function CompositeProgress() {
  const { status, progress, message, error, cancelComposite, reset } = useComposite();

  const progressPercent = Math.round(progress * 100);

  if (status === 'error') {
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
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </div>
          <h3 className="text-xl font-semibold text-white mb-2">Composite Failed</h3>
          <p className="text-red-400 text-sm">{error}</p>
        </div>

        <button
          onClick={reset}
          className="w-full py-2 px-4 rounded-lg border border-gray-700 text-gray-300 hover:bg-gray-800 transition-colors"
        >
          Try Again
        </button>
      </div>
    );
  }

  return (
    <div className="bg-[--color-dark-lighter] rounded-xl p-6 space-y-6">
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
          {status === 'loading' ? 'Loading FFmpeg...' : 'Processing Video'}
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
          <p className="text-yellow-500 text-sm font-medium">Processing in browser</p>
          <p className="text-gray-400 text-xs mt-1">
            This may take a while for long recordings. Please don't close this tab.
          </p>
        </div>
      </div>

      {/* Cancel button */}
      <button
        onClick={cancelComposite}
        className="w-full py-2 px-4 rounded-lg border border-gray-700 text-gray-300 hover:bg-gray-800 transition-colors"
      >
        Cancel
      </button>
    </div>
  );
}
