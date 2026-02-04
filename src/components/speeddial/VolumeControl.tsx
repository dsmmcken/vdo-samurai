interface VolumeControlProps {
  volume: number;
  onChange: (volume: number) => void;
}

export function VolumeControl({ volume, onChange }: VolumeControlProps) {
  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => onChange(volume === 0 ? 0.8 : 0)}
        className="p-1 hover:bg-white/10 rounded"
        aria-label={volume === 0 ? 'Unmute' : 'Mute'}
      >
        {volume === 0 ? (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2"
            />
          </svg>
        ) : (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"
            />
          </svg>
        )}
      </button>
      <input
        type="range"
        min="0"
        max="1"
        step="0.05"
        value={volume}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-24 h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer accent-white"
        aria-label="Volume"
      />
      <span className="text-xs text-gray-400 w-8">{Math.round(volume * 100)}%</span>
    </div>
  );
}
