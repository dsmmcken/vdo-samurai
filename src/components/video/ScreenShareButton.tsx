import { useScreenShare } from '../../hooks/useScreenShare';
import { ScreenSourcePicker } from './ScreenSourcePicker';

export function ScreenShareButton() {
  const { isSharing, showPicker, startSharing, startSharingWithSource, stopSharing, cancelPicker, error } =
    useScreenShare();

  const handleClick = async () => {
    if (isSharing) {
      stopSharing();
    } else {
      try {
        await startSharing();
      } catch {
        // Error already handled in hook
      }
    }
  };

  const handleSourceSelect = async (sourceId: string) => {
    try {
      await startSharingWithSource(sourceId);
    } catch {
      // Error already handled in hook
    }
  };

  return (
    <>
      <button
        onClick={handleClick}
        className={`p-3 sm:p-4 rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[--color-dark] ${
          isSharing
            ? 'bg-green-500 hover:bg-green-600 text-white'
            : 'bg-gray-700 hover:bg-gray-600 text-white'
        }`}
        aria-label={isSharing ? 'Stop sharing screen' : 'Share screen'}
        aria-pressed={isSharing}
        title={isSharing ? 'Stop sharing screen' : 'Share screen'}
      >
        <svg
          className="w-5 h-5 sm:w-6 sm:h-6"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
          />
        </svg>
      </button>
      {error && <p className="text-red-400 text-sm mt-1 absolute">{error}</p>}

      {showPicker && <ScreenSourcePicker onSelect={handleSourceSelect} onCancel={cancelPicker} />}
    </>
  );
}
