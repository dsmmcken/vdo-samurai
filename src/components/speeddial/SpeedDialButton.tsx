import { useSpeedDialStore } from '../../store/speedDialStore';

export function SpeedDialButton() {
  const { isPanelOpen, isPlaying, setPanelOpen } = useSpeedDialStore();

  return (
    <button
      onClick={() => setPanelOpen(!isPanelOpen)}
      className={`p-2 sm:p-3 rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black ${
        isPlaying
          ? 'bg-purple-500/70 hover:bg-purple-500/90 text-white'
          : isPanelOpen
            ? 'bg-white/20 hover:bg-white/30 text-white'
            : 'bg-black/50 hover:bg-black/70 text-white'
      }`}
      aria-label={isPanelOpen ? 'Close Speed Dial' : 'Open Speed Dial'}
      aria-pressed={isPanelOpen}
      aria-expanded={isPanelOpen}
      title={isPanelOpen ? 'Close Speed Dial' : 'Speed Dial - Play video clips'}
    >
      {/* Film/video icon */}
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
          d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z"
        />
      </svg>
      {/* Playing indicator dot */}
      {isPlaying && (
        <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-green-400 rounded-full animate-pulse" />
      )}
    </button>
  );
}
