import type { SpeedDialClip } from '../../types/speeddial';

interface SpeedDialClipItemProps {
  clip: SpeedDialClip;
  index: number;
  isActive: boolean;
  isPlaying: boolean;
  onPlay: () => void;
  onStop: () => void;
  onRemove: () => void;
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function SpeedDialClipItem({
  clip,
  index,
  isActive,
  isPlaying,
  onPlay,
  onStop,
  onRemove
}: SpeedDialClipItemProps) {
  const shortcutKey = index < 9 ? index + 1 : null;

  return (
    <div
      className={`flex items-center gap-3 p-2 rounded-lg transition-colors ${
        isActive ? 'bg-green-500/20 border border-green-500/50' : 'bg-white/5 hover:bg-white/10'
      }`}
    >
      {/* Thumbnail */}
      <div className="relative w-16 h-10 bg-gray-800 rounded overflow-hidden flex-shrink-0">
        {clip.thumbnailUrl ? (
          <img src={clip.thumbnailUrl} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-500">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
              />
            </svg>
          </div>
        )}
        {/* Keyboard shortcut badge */}
        {shortcutKey && (
          <span className="absolute top-0.5 left-0.5 bg-black/70 text-white text-[10px] px-1 rounded font-mono">
            {shortcutKey}
          </span>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="text-sm text-white truncate" title={clip.name}>
          {clip.name}
        </p>
        <p className="text-xs text-gray-400">{formatDuration(clip.duration)}</p>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 flex-shrink-0">
        {isActive && isPlaying ? (
          <button
            onClick={onStop}
            className="p-1.5 rounded-full bg-red-500/20 hover:bg-red-500/40 text-red-400 transition-colors"
            aria-label="Stop"
            title="Stop (Esc)"
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <rect x="6" y="6" width="12" height="12" rx="1" />
            </svg>
          </button>
        ) : (
          <button
            onClick={onPlay}
            className="p-1.5 rounded-full bg-green-500/20 hover:bg-green-500/40 text-green-400 transition-colors"
            aria-label={`Play ${clip.name}`}
            title={shortcutKey ? `Play (${shortcutKey})` : 'Play'}
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          </button>
        )}
        <button
          onClick={onRemove}
          className="p-1.5 rounded-full hover:bg-white/10 text-gray-400 hover:text-red-400 transition-colors"
          aria-label={`Remove ${clip.name}`}
          title="Remove clip"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}
