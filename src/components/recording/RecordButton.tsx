interface RecordButtonProps {
  isRecording: boolean;
  isHost: boolean;
  countdown: number | null;
  onStart: () => void;
  onStop: () => void;
}

export function RecordButton({
  isRecording,
  isHost,
  countdown,
  onStart,
  onStop
}: RecordButtonProps) {
  // Only show to host
  if (!isHost) return null;

  const isCountingDown = countdown !== null;
  const isDisabled = isCountingDown;

  const buttonText = isCountingDown
    ? 'Starting...'
    : isRecording
      ? 'Stop Recording'
      : 'Start Recording';

  // Short text for mobile
  const mobileText = isCountingDown ? '...' : isRecording ? 'Stop' : 'Record';

  return (
    <button
      onClick={isRecording ? onStop : onStart}
      disabled={isDisabled}
      aria-label={buttonText}
      aria-pressed={isRecording}
      className={`
        flex items-center gap-1.5 sm:gap-2 px-3 sm:px-5 py-2.5 sm:py-3 rounded-full font-medium transition-all
        focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[--color-dark]
        ${isDisabled ? 'opacity-50 cursor-not-allowed' : ''}
        ${
          isRecording
            ? 'bg-red-500 hover:bg-red-600 text-white'
            : 'bg-gray-700 hover:bg-gray-600 text-white'
        }
      `}
    >
      <span
        className={`w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-full ${isRecording ? 'bg-white animate-pulse' : 'bg-red-500'}`}
        aria-hidden="true"
      />
      <span className="sm:hidden text-sm">{mobileText}</span>
      <span className="hidden sm:inline">{buttonText}</span>
    </button>
  );
}
