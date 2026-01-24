import { type KeyboardEvent } from 'react';
import { VideoElement } from './VideoElement';

interface UserTileProps {
  stream: MediaStream | null;
  screenStream?: MediaStream | null;
  name: string;
  isFocused: boolean;
  isHost?: boolean;
  onClick: () => void;
  muted?: boolean;
}

export function UserTile({
  stream,
  screenStream,
  name,
  isFocused,
  isHost = false,
  onClick,
  muted = false
}: UserTileProps) {
  // Always show camera stream in tiles, never screen share
  const displayStream = stream;
  const isSharing = screenStream !== null;

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onClick();
    }
  };

  return (
    <div
      onClick={onClick}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
      aria-pressed={isFocused}
      aria-label={`${name}${isHost ? ' (Host)' : ''}${isSharing ? ' sharing screen' : ''}. ${isFocused ? 'Currently focused.' : 'Click to focus.'}`}
      className={`
        relative aspect-square bg-[--color-dark-lighter] rounded-lg overflow-hidden cursor-pointer
        border-2 transition-all duration-200 outline-none
        focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[--color-dark]
        ${isFocused ? 'border-[--color-primary] ring-2 ring-[--color-primary]/30' : 'border-transparent hover:border-gray-600'}
      `}
    >
      {displayStream ? (
        <VideoElement stream={displayStream} muted={muted} />
      ) : (
        <div className="w-full h-full flex items-center justify-center">
          <div className="w-10 h-10 sm:w-16 sm:h-16 rounded-full bg-gray-700 flex items-center justify-center text-xl sm:text-2xl font-bold text-gray-400">
            {name.charAt(0).toUpperCase()}
          </div>
        </div>
      )}

      {/* Screen share badge */}
      {isSharing && (
        <div className="absolute top-1 left-1 sm:top-2 sm:left-2 flex items-center gap-1 bg-green-500/90 text-white text-xs px-1.5 py-0.5 sm:px-2 sm:py-1 rounded-full">
          <svg
            className="w-2.5 h-2.5 sm:w-3 sm:h-3"
            fill="currentColor"
            viewBox="0 0 20 20"
            aria-hidden="true"
          >
            <path d="M3 4a1 1 0 011-1h12a1 1 0 011 1v8a1 1 0 01-1 1H4a1 1 0 01-1-1V4z" />
          </svg>
          <span className="hidden sm:inline">Screen</span>
        </div>
      )}

      {/* Host badge */}
      {isHost && (
        <div className="absolute top-1 right-1 sm:top-2 sm:right-2 bg-[--color-primary]/90 text-white text-xs px-1.5 py-0.5 sm:px-2 sm:py-1 rounded-full">
          Host
        </div>
      )}

      {/* Name label */}
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-1.5 sm:p-2">
        <span className="text-xs sm:text-sm font-medium truncate block">{name}</span>
      </div>
    </div>
  );
}
