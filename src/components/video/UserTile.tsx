import { type KeyboardEvent } from 'react';
import { VideoElement } from './VideoElement';
import { AudioLevelBar } from './AudioLevelBar';
import { useAudioLevel } from '../../hooks/useAudioLevel';

interface UserTileProps {
  stream: MediaStream | null;
  screenStream?: MediaStream | null;
  name: string;
  isFocused: boolean;
  isHost?: boolean;
  onClick: () => void;
  muted?: boolean;
  videoEnabled?: boolean; // Whether video is currently on
  audioEnabled?: boolean; // Whether audio is currently on
  isScreenSharing?: boolean; // Whether user has screen sharing enabled (for remote peers)
}

export function UserTile({
  stream,
  screenStream,
  name,
  isFocused,
  isHost = false,
  onClick,
  muted = false,
  videoEnabled = true,
  audioEnabled = true,
  isScreenSharing = false
}: UserTileProps) {
  // Always show camera stream in tiles, never screen share
  const displayStream = stream;
  // Show badge if either we have the screen stream OR peer reported they're sharing
  const isSharing = screenStream !== null || isScreenSharing;
  const { level } = useAudioLevel(stream);

  // Check if stream has active video track
  const hasActiveVideo =
    displayStream?.getVideoTracks().some((track) => track.readyState === 'live' && track.enabled) ??
    false;

  // Show video if: we have a stream, videoEnabled is true, and there's an active video track
  const showVideo = displayStream && videoEnabled && hasActiveVideo;

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onClick();
    }
  };

  return (
    <div className="flex flex-col gap-1 flex-shrink-0">
      <div
        onClick={onClick}
        onKeyDown={handleKeyDown}
        role="button"
        tabIndex={0}
        aria-pressed={isFocused}
        aria-label={`${name}${isHost ? ' (Host)' : ''}${isSharing ? ' sharing screen' : ''}${!videoEnabled ? ' video off' : ''}${!audioEnabled ? ' muted' : ''}. ${isFocused ? 'Currently focused.' : 'Click to focus.'}`}
        className={`
          relative w-24 h-24 sm:w-28 sm:h-28 bg-gray-900 rounded-lg overflow-hidden cursor-pointer
          border-2 transition-all duration-200 outline-none
          focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black
          ${isFocused ? 'border-[--color-primary] ring-2 ring-[--color-primary]/30' : 'border-transparent hover:border-gray-600'}
        `}
      >
        {showVideo ? (
          <VideoElement
            stream={displayStream}
            muted={muted}
            className="w-full h-full object-cover"
          />
        ) : (
          // Blank frame when video is off - show avatar with status icons
          <div className="w-full h-full flex flex-col items-center justify-center bg-gray-800">
            {/* Avatar */}
            <div className="w-10 h-10 sm:w-14 sm:h-14 rounded-full bg-gray-700 flex items-center justify-center text-lg sm:text-xl font-bold text-gray-400 mb-2">
              {name.charAt(0).toUpperCase()}
            </div>

            {/* Muted status icons */}
            <div className="flex gap-1.5">
              {/* Video off icon */}
              {!videoEnabled && (
                <div className="p-1 rounded-full bg-red-500/80" title="Video off">
                  <svg
                    className="w-3 h-3 sm:w-4 sm:h-4 text-white"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"
                    />
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M3 3l18 18"
                    />
                  </svg>
                </div>
              )}

              {/* Audio muted icon */}
              {!audioEnabled && (
                <div className="p-1 rounded-full bg-red-500/80" title="Muted">
                  <svg
                    className="w-3 h-3 sm:w-4 sm:h-4 text-white"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
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
                </div>
              )}
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

        {/* Muted indicator badge (shown in top-right when video is on but audio is off) */}
        {showVideo && !audioEnabled && (
          <div className="absolute top-1 right-1 sm:top-2 sm:right-2 p-1 rounded-full bg-red-500/80">
            <svg
              className="w-3 h-3 text-white"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
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
          </div>
        )}

        {/* Name label */}
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-1.5 sm:p-2">
          <span className="text-xs sm:text-sm font-medium truncate flex items-center gap-1">
            {isHost && (
              <svg
                className="w-4 h-4 sm:w-5 sm:h-5 flex-shrink-0 text-yellow-400"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
              </svg>
            )}
            {name}
          </span>
        </div>
      </div>

      {/* Audio level bar */}
      <AudioLevelBar level={level} />
    </div>
  );
}
