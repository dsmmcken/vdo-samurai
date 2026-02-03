import { useScreenShare, type ScreenShareOptions } from '../../hooks/useScreenShare';
import { ScreenSourcePicker } from './ScreenSourcePicker';

interface ScreenShareButtonProps {
  /** Called when screen share starts during an active recording */
  onScreenShareStartedDuringRecording?: ScreenShareOptions['onScreenShareStartedDuringRecording'];
  /** Called when screen share ends during an active recording */
  onScreenShareEndedDuringRecording?: ScreenShareOptions['onScreenShareEndedDuringRecording'];
}

export function ScreenShareButton({
  onScreenShareStartedDuringRecording,
  onScreenShareEndedDuringRecording
}: ScreenShareButtonProps = {}) {
  const {
    isSharing,
    showPicker,
    startSharing,
    startSharingWithSource,
    stopSharing,
    cancelPicker,
    error
  } = useScreenShare({
    onScreenShareStartedDuringRecording,
    onScreenShareEndedDuringRecording
  });

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
        className={`p-2 sm:p-3 rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black ${
          isSharing
            ? 'bg-green-500/70 hover:bg-green-500/90 text-white'
            : 'bg-black/50 hover:bg-black/70 text-white'
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
