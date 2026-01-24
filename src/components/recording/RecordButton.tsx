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
      ? 'Stop'
      : 'Record';

  return (
    <button
      onClick={isRecording ? onStop : onStart}
      disabled={isDisabled}
      aria-label={buttonText}
      aria-pressed={isRecording}
      className={`
        flex items-center gap-1 sm:gap-1.5 px-2 sm:px-4 py-2 sm:py-2.5 rounded-full font-medium transition-all
        focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black
        ${isDisabled ? 'opacity-50 cursor-not-allowed' : ''}
        ${
          isRecording
            ? 'bg-red-500/70 hover:bg-red-500/90 text-white'
            : 'bg-black/50 hover:bg-black/70 text-white'
        }
      `}
    >
      <span
        className={`w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-full ${isRecording ? 'bg-white animate-pulse' : 'bg-red-500'}`}
        aria-hidden="true"
      />
      <span className="text-sm">{buttonText}</span>
    </button>
  );
}
